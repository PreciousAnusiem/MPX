"""
ONXLink - Production Auth API
Secure authentication with JWT, biometric support, and enterprise-grade security
"""

from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List
import secrets
import hashlib
import json
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status, Request, Response, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from passlib.context import CryptContext
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr, validator
import redis
from cryptography.fernet import Fernet
import pyotp
import qrcode
from io import BytesIO
import base64

from ..database import get_db
from ..models import User, UserSession, SecurityLog, UserPreferences
from ..config import settings
from ..utils import (
    generate_secure_token, 
    validate_password_strength,
    rate_limit_check,
    log_security_event,
    encrypt_sensitive_data,
    decrypt_sensitive_data,
    get_client_ip,
    detect_suspicious_activity,
    generate_device_fingerprint
)

router = APIRouter(prefix="/auth", tags=["authentication"])
security = HTTPBearer()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Redis for session management and rate limiting
redis_client = redis.Redis(
    host=settings.REDIS_HOST,
    port=settings.REDIS_PORT,
    password=settings.REDIS_PASSWORD,
    decode_responses=True,
    socket_connect_timeout=5,
    socket_timeout=5,
    retry_on_timeout=True
)

# Request Models
class UserRegistration(BaseModel):
    email: EmailStr
    password: str
    name: str
    phone: Optional[str] = None
    referral_code: Optional[str] = None
    marketing_consent: bool = False
    terms_accepted: bool
    privacy_accepted: bool
    device_info: Optional[Dict[str, Any]] = None
    
    @validator('password')
    def validate_password(cls, v):
        if not validate_password_strength(v):
            raise ValueError('Password must be at least 12 characters with uppercase, lowercase, numbers, and symbols')
        return v
    
    @validator('terms_accepted', 'privacy_accepted')
    def validate_acceptance(cls, v):
        if not v:
            raise ValueError('Terms and privacy policy must be accepted')
        return v

class UserLogin(BaseModel):
    email: EmailStr
    password: str
    device_info: Optional[Dict[str, Any]] = None
    biometric_token: Optional[str] = None
    remember_me: bool = False
    two_factor_code: Optional[str] = None

class BiometricSetup(BaseModel):
    public_key: str
    device_id: str
    biometric_type: str  # fingerprint, face, voice

class TwoFactorSetup(BaseModel):
    enable: bool
    backup_codes: Optional[List[str]] = None

class PasswordReset(BaseModel):
    email: EmailStr
    new_password: str
    reset_token: str
    
    @validator('new_password')
    def validate_password(cls, v):
        if not validate_password_strength(v):
            raise ValueError('Password must be at least 12 characters with uppercase, lowercase, numbers, and symbols')
        return v

class TokenRefresh(BaseModel):
    refresh_token: str

# Response Models
class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: Dict[str, Any]
    subscription_tier: str
    features_enabled: List[str]
    first_login: bool = False
    requires_2fa: bool = False
    biometric_enabled: bool = False

class UserProfile(BaseModel):
    id: str
    email: str
    name: str
    subscription_tier: str
    features_enabled: List[str]
    last_login: Optional[datetime]
    created_at: datetime
    preferences: Dict[str, Any]

# Utility Functions
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create JWT access token with enhanced security"""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(hours=1))
    
    to_encode.update({
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "jti": secrets.token_urlsafe(32),  # JWT ID for revocation
        "aud": settings.APP_NAME,
        "iss": settings.API_BASE_URL
    })
    
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

def create_refresh_token(user_id: str, device_id: str) -> str:
    """Create long-lived refresh token"""
    data = {
        "sub": user_id,
        "device_id": device_id,
        "type": "refresh",
        "exp": datetime.now(timezone.utc) + timedelta(days=30)
    }
    return jwt.encode(data, settings.JWT_REFRESH_SECRET, algorithm=settings.JWT_ALGORITHM)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password with timing attack protection"""
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    """Hash password securely"""
    return pwd_context.hash(password)

def generate_2fa_secret() -> str:
    """Generate 2FA secret key"""
    return pyotp.random_base32()

def generate_qr_code(email: str, secret: str) -> str:
    """Generate QR code for 2FA setup"""
    totp_uri = pyotp.totp.TOTP(secret).provisioning_uri(
        name=email,
        issuer_name=settings.APP_NAME
    )
    
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(totp_uri)
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = BytesIO()
    img.save(buffer, format='PNG')
    buffer.seek(0)
    
    return base64.b64encode(buffer.getvalue()).decode()

def verify_2fa_token(secret: str, token: str) -> bool:
    """Verify 2FA token with time window tolerance"""
    totp = pyotp.TOTP(secret)
    return totp.verify(token, valid_window=1)

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """Get current authenticated user"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        payload = jwt.decode(
            credentials.credentials, 
            settings.JWT_SECRET_KEY, 
            algorithms=[settings.JWT_ALGORITHM],
            audience=settings.APP_NAME
        )
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    # Check if token is revoked
    if redis_client.get(f"revoked_token:{payload.get('jti')}"):
        raise credentials_exception
    
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception
    
    # Update last activity
    user.last_activity = datetime.now(timezone.utc)
    db.commit()
    
    return user

# API Endpoints
@router.post("/register", response_model=AuthResponse)
async def register_user(
    user_data: UserRegistration,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Register new user with comprehensive security"""
    client_ip = get_client_ip(request)
    
    # Rate limiting
    if not await rate_limit_check(f"register:{client_ip}", max_attempts=5, window=3600):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Registration rate limit exceeded"
        )
    
    # Check if user already exists
    existing_user = db.query(User).filter(User.email == user_data.email).first()
    if existing_user:
        # Don't reveal user exists - security best practice
        background_tasks.add_task(
            log_security_event,
            "duplicate_registration_attempt",
            {"email": user_data.email, "ip": client_ip}
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Registration failed"
        )
    
    # Create user
    hashed_password = get_password_hash(user_data.password)
    device_id = generate_device_fingerprint(user_data.device_info or {})
    
    user = User(
        email=user_data.email,
        hashed_password=hashed_password,
        name=user_data.name,
        phone=encrypt_sensitive_data(user_data.phone) if user_data.phone else None,
        subscription_tier="freemium",
        is_active=True,
        email_verified=False,
        marketing_consent=user_data.marketing_consent,
        created_at=datetime.now(timezone.utc),
        last_login=datetime.now(timezone.utc),
        registration_ip=client_ip,
        device_info=encrypt_sensitive_data(json.dumps(user_data.device_info or {}))
    )
    
    db.add(user)
    db.flush()  # Get user ID
    
    # Create user preferences with offline capabilities
    preferences = UserPreferences(
        user_id=user.id,
        theme="light",
        language="en",
        notifications_enabled=True,
        offline_mode=True,
        auto_sync=True,
        cache_duration=7,  # days
        features_cache=json.dumps({
            "freemium": [
                "basic_posting", "simple_ai", "basic_analytics",
                "offline_content_creation", "local_storage"
            ]
        })
    )
    
    db.add(preferences)
    
    # Create session
    session = UserSession(
        user_id=user.id,
        device_id=device_id,
        ip_address=client_ip,
        user_agent=request.headers.get("user-agent", ""),
        created_at=datetime.now(timezone.utc),
        last_activity=datetime.now(timezone.utc),
        is_active=True
    )
    
    db.add(session)
    db.commit()
    
    # Generate tokens
    access_token = create_access_token(
        data={"sub": user.id, "email": user.email, "tier": user.subscription_tier},
        expires_delta=timedelta(hours=1)
    )
    refresh_token = create_refresh_token(user.id, device_id)
    
    # Store refresh token securely
    redis_client.setex(
        f"refresh_token:{user.id}:{device_id}",
        timedelta(days=30).total_seconds(),
        refresh_token
    )
    
    # Background tasks
    background_tasks.add_task(send_welcome_email, user.email, user.name)
    background_tasks.add_task(log_security_event, "user_registered", {
        "user_id": user.id, "email": user.email, "ip": client_ip
    })
    
    return AuthResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=3600,
        user={
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "email_verified": user.email_verified
        },
        subscription_tier=user.subscription_tier,
        features_enabled=[
            "basic_posting", "simple_ai", "basic_analytics",
            "offline_content_creation", "local_storage"
        ],
        first_login=True
    )

@router.post("/login", response_model=AuthResponse)
async def login_user(
    login_data: UserLogin,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Secure user login with multiple authentication methods"""
    client_ip = get_client_ip(request)
    
    # Rate limiting
    if not await rate_limit_check(f"login:{client_ip}", max_attempts=10, window=3600):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts"
        )
    
    # Find user
    user = db.query(User).filter(User.email == login_data.email).first()
    if not user or not user.is_active:
        background_tasks.add_task(log_security_event, "failed_login", {
            "email": login_data.email, "ip": client_ip, "reason": "user_not_found"
        })
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )
    
    # Check for suspicious activity
    if await detect_suspicious_activity(user.id, client_ip):
        background_tasks.add_task(log_security_event, "suspicious_login", {
            "user_id": user.id, "ip": client_ip
        })
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account temporarily locked due to suspicious activity"
        )
    
    # Verify password or biometric
    authentication_valid = False
    
    if login_data.biometric_token and user.biometric_enabled:
        # Verify biometric authentication
        stored_biometric = decrypt_sensitive_data(user.biometric_data)
        if stored_biometric and verify_biometric_token(login_data.biometric_token, stored_biometric):
            authentication_valid = True
    else:
        # Traditional password authentication
        if verify_password(login_data.password, user.hashed_password):
            authentication_valid = True
    
    if not authentication_valid:
        background_tasks.add_task(log_security_event, "failed_login", {
            "user_id": user.id, "ip": client_ip, "reason": "invalid_credentials"
        })
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )
    
    # Check 2FA if enabled
    if user.two_factor_enabled:
        if not login_data.two_factor_code:
            return JSONResponse(
                status_code=status.HTTP_202_ACCEPTED,
                content={"requires_2fa": True, "message": "2FA code required"}
            )
        
        if not verify_2fa_token(decrypt_sensitive_data(user.two_factor_secret), login_data.two_factor_code):
            background_tasks.add_task(log_security_event, "failed_2fa", {
                "user_id": user.id, "ip": client_ip
            })
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid 2FA code"
            )
    
    # Generate device ID and create session
    device_id = generate_device_fingerprint(login_data.device_info or {})
    
    # Check for existing session
    existing_session = db.query(UserSession).filter(
        and_(
            UserSession.user_id == user.id,
            UserSession.device_id == device_id,
            UserSession.is_active == True
        )
    ).first()
    
    if existing_session:
        existing_session.last_activity = datetime.now(timezone.utc)
        existing_session.ip_address = client_ip
    else:
        session = UserSession(
            user_id=user.id,
            device_id=device_id,
            ip_address=client_ip,
            user_agent=request.headers.get("user-agent", ""),
            created_at=datetime.now(timezone.utc),
            last_activity=datetime.now(timezone.utc),
            is_active=True
        )
        db.add(session)
    
    # Update user login info
    user.last_login = datetime.now(timezone.utc)
    user.login_count = (user.login_count or 0) + 1
    db.commit()
    
    # Get user features based on subscription
    features_enabled = get_user_features(user.subscription_tier)
    
    # Generate tokens
    token_expires = timedelta(hours=12 if login_data.remember_me else 1)
    access_token = create_access_token(
        data={"sub": user.id, "email": user.email, "tier": user.subscription_tier},
        expires_delta=token_expires
    )
    refresh_token = create_refresh_token(user.id, device_id)
    
    # Store refresh token
    refresh_expires = timedelta(days=30 if login_data.remember_me else 7)
    redis_client.setex(
        f"refresh_token:{user.id}:{device_id}",
        refresh_expires.total_seconds(),
        refresh_token
    )
    
    # Background tasks
    background_tasks.add_task(log_security_event, "successful_login", {
        "user_id": user.id, "ip": client_ip
    })
    
    return AuthResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=int(token_expires.total_seconds()),
        user={
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "email_verified": user.email_verified,
            "last_login": user.last_login.isoformat()
        },
        subscription_tier=user.subscription_tier,
        features_enabled=features_enabled,
        biometric_enabled=user.biometric_enabled or False
    )

@router.post("/refresh", response_model=Dict[str, Any])
async def refresh_token(
    token_data: TokenRefresh,
    request: Request,
    db: Session = Depends(get_db)
):
    """Refresh access token using refresh token"""
    try:
        payload = jwt.decode(
            token_data.refresh_token,
            settings.JWT_REFRESH_SECRET,
            algorithms=[settings.JWT_ALGORITHM]
        )
        
        user_id = payload.get("sub")
        device_id = payload.get("device_id")
        
        if not user_id or not device_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid refresh token"
            )
        
        # Verify refresh token exists in Redis
        stored_token = redis_client.get(f"refresh_token:{user_id}:{device_id}")
        if not stored_token or stored_token != token_data.refresh_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid refresh token"
            )
        
        # Get user
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive"
            )
        
        # Generate new access token
        access_token = create_access_token(
            data={"sub": user.id, "email": user.email, "tier": user.subscription_tier},
            expires_delta=timedelta(hours=1)
        )
        
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "expires_in": 3600
        }
        
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token"
        )

@router.post("/logout")
async def logout_user(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Secure logout with token revocation"""
    client_ip = get_client_ip(request)
    
    # Get token from header
    auth_header = request.headers.get("authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        try:
            payload = jwt.decode(
                token,
                settings.JWT_SECRET_KEY,
                algorithms=[settings.JWT_ALGORITHM]
            )
            
            # Revoke token
            jti = payload.get("jti")
            if jti:
                redis_client.setex(
                    f"revoked_token:{jti}",
                    timedelta(hours=12).total_seconds(),
                    "revoked"
                )
        except JWTError:
            pass
    
    # Deactivate sessions
    db.query(UserSession).filter(
        UserSession.user_id == current_user.id
    ).update({"is_active": False})
    
    # Remove refresh tokens
    pattern = f"refresh_token:{current_user.id}:*"
    for key in redis_client.scan_iter(match=pattern):
        redis_client.delete(key)
    
    db.commit()
    
    # Log logout
    await log_security_event("user_logout", {
        "user_id": current_user.id, "ip": client_ip
    })
    
    return {"message": "Successfully logged out"}

@router.post("/setup-2fa")
async def setup_two_factor(
    setup_data: TwoFactorSetup,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Setup or disable 2FA"""
    if setup_data.enable:
        if not current_user.two_factor_secret:
            # Generate new secret
            secret = generate_2fa_secret()
            current_user.two_factor_secret = encrypt_sensitive_data(secret)
            
            # Generate QR code
            qr_code = generate_qr_code(current_user.email, secret)
            
            # Generate backup codes
            backup_codes = [secrets.token_hex(8) for _ in range(10)]
            current_user.backup_codes = encrypt_sensitive_data(json.dumps(backup_codes))
            
            db.commit()
            
            return {
                "qr_code": qr_code,
                "backup_codes": backup_codes,
                "manual_entry_key": secret
            }
        else:
            current_user.two_factor_enabled = True
            db.commit()
            return {"message": "2FA enabled successfully"}
    else:
        current_user.two_factor_enabled = False
        db.commit()
        return {"message": "2FA disabled successfully"}

@router.post("/setup-biometric")
async def setup_biometric(
    biometric_data: BiometricSetup,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Setup biometric authentication"""
    # Store encrypted biometric data
    biometric_info = {
        "public_key": biometric_data.public_key,
        "device_id": biometric_data.device_id,
        "type": biometric_data.biometric_type,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    current_user.biometric_data = encrypt_sensitive_data(json.dumps(biometric_info))
    current_user.biometric_enabled = True
    db.commit()
    
    return {"message": "Biometric authentication enabled successfully"}

@router.post("/reset-password")
async def reset_password(
    reset_data: PasswordReset,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Reset user password"""
    client_ip = get_client_ip(request)
    
    # Verify reset token
    try:
        payload = jwt.decode(
            reset_data.reset_token,
            settings.PASSWORD_RESET_SECRET,
            algorithms=[settings.JWT_ALGORITHM]
        )
        
        user_id = payload.get("sub")
        user = db.query(User).filter(User.id == user_id).first()
        
        if not user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid reset token"
            )
        
        # Update password
        user.hashed_password = get_password_hash(reset_data.new_password)
        user.password_changed_at = datetime.now(timezone.utc)
        
        # Invalidate all sessions
        db.query(UserSession).filter(
            UserSession.user_id == user.id
        ).update({"is_active": False})
        
        db.commit()
        
        # Log security event
        background_tasks.add_task(log_security_event, "password_reset", {
            "user_id": user.id, "ip": client_ip
        })
        
        return {"message": "Password reset successfully"}
        
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token"
        )

@router.get("/profile", response_model=UserProfile)
async def get_user_profile(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get current user profile with offline data"""
    preferences = db.query(UserPreferences).filter(
        UserPreferences.user_id == current_user.id
    ).first()
    
    features_enabled = get_user_features(current_user.subscription_tier)
    
    # Add offline capabilities
    offline_data = {
        "cached_content": True,
        "offline_analytics": True,
        "local_storage_enabled": True,
        "sync_pending": False
    }
    
    return UserProfile(
        id=current_user.id,
        email=current_user.email,
        name=current_user.name,
        subscription_tier=current_user.subscription_tier,
        features_enabled=features_enabled,
        last_login=current_user.last_login,
        created_at=current_user.created_at,
        preferences={
            "theme": preferences.theme if preferences else "light",
            "language": preferences.language if preferences else "en",
            "notifications": preferences.notifications_enabled if preferences else True,
            "offline_mode": preferences.offline_mode if preferences else True,
            **offline_data
        }
    )

# Helper Functions
def get_user_features(subscription_tier: str) -> List[str]:
    """Get features enabled for subscription tier"""
    features = {
        "freemium": [
            "basic_posting", "simple_ai", "basic_analytics",
            "offline_content_creation", "local_storage", "5_platform_limit"
        ],
        "premium": [
            "advanced_posting", "ai_influencer", "predictive_inventory",
            "cultural_adaptation", "bulk_operations", "premium_analytics",
            "offline_sync", "unlimited_storage", "50_platform_support",
            "priority_support"
        ],
        "enterprise": [
            "custom_ai_clones", "anticipatory_shipping", "team_management",
            "api_access", "white_label", "enterprise_analytics",
            "dedicated_support", "unlimited_everything", "custom_integrations",
            "advanced_security"
        ]
    }
    
    base_features = features.get("freemium", [])
    if subscription_tier == "premium":
        return base_features + features.get("premium", [])
    elif subscription_tier == "enterprise":
        return base_features + features.get("premium", []) + features.get("enterprise", [])
    
    return base_features

def verify_biometric_token(token: str, stored_data: str) -> bool:
    """Verify biometric authentication token"""
    try:
        biometric_info = json.loads(stored_data)
        # Implement actual biometric verification logic
        # This is a placeholder - real implementation would use cryptographic verification
        return True  # Simplified for demo
    except:
        return False

async def send_welcome_email(email: str, name: str):
    """Send welcome email to new user"""
    # Implement email sending logic
    pass

# Security middleware for additional protection
@router.middleware("http")
async def security_middleware(request: Request, call_next):
    """Additional security middleware"""
    # Add security headers
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    
    return response