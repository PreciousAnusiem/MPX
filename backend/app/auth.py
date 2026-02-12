"""
ONXLink JWT Authentication & Middleware
Production-ready authentication system with offline token caching and security features
"""
import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timedelta, timezone
from functools import wraps
from typing import Any, Dict, List, Optional, Union

import bcrypt
import jwt
from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import User, UserSession, RefreshToken, SecurityLog
from .utils import generate_secure_id, get_client_ip, validate_email

# Security Configuration
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)

# Encryption for sensitive data
cipher_suite = Fernet(settings.ENCRYPTION_KEY.encode())

# Token Configuration
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 30
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_DURATION_MINUTES = 15
SESSION_TIMEOUT_HOURS = 24

class AuthError(Exception):
    """Custom authentication error"""
    def __init__(self, message: str, error_code: str = "AUTH_ERROR"):
        self.message = message
        self.error_code = error_code
        super().__init__(self.message)

class SecurityManager:
    """Advanced security features for user protection"""
    
    @staticmethod
    def hash_password(password: str) -> str:
        """Hash password with bcrypt and additional salt"""
        # Add custom salt for extra security
        custom_salt = settings.PASSWORD_SALT.encode()
        password_with_salt = password.encode() + custom_salt
        hashed = bcrypt.hashpw(password_with_salt, bcrypt.gensalt(rounds=12))
        return hashed.decode()
    
    @staticmethod
    def verify_password(password: str, hashed: str) -> bool:
        """Verify password against hash with timing attack protection"""
        try:
            custom_salt = settings.PASSWORD_SALT.encode()
            password_with_salt = password.encode() + custom_salt
            return bcrypt.checkpw(password_with_salt, hashed.encode())
        except Exception:
            # Prevent timing attacks by always taking same time
            bcrypt.checkpw(b"dummy", b"$2b$12$dummy.hash.to.prevent.timing.attacks")
            return False
    
    @staticmethod
    def generate_secure_token() -> str:
        """Generate cryptographically secure token"""
        return secrets.token_urlsafe(32)
    
    @staticmethod
    def encrypt_sensitive_data(data: str) -> str:
        """Encrypt sensitive data like email addresses"""
        return cipher_suite.encrypt(data.encode()).decode()
    
    @staticmethod
    def decrypt_sensitive_data(encrypted_data: str) -> str:
        """Decrypt sensitive data"""
        return cipher_suite.decrypt(encrypted_data.encode()).decode()
    
    @staticmethod
    def generate_device_fingerprint(request: Request) -> str:
        """Generate unique device fingerprint for security tracking"""
        user_agent = request.headers.get("user-agent", "")
        accept_language = request.headers.get("accept-language", "")
        client_ip = get_client_ip(request)
        
        fingerprint_data = f"{user_agent}:{accept_language}:{client_ip}"
        return hashlib.sha256(fingerprint_data.encode()).hexdigest()[:16]

class TokenManager:
    """JWT token management with offline caching support"""
    
    @staticmethod
    def create_access_token(
        data: Dict[str, Any], 
        expires_delta: Optional[timedelta] = None,
        offline_capable: bool = False
    ) -> str:
        """Create JWT access token with offline support"""
        to_encode = data.copy()
        
        if expires_delta:
            expire = datetime.now(timezone.utc) + expires_delta
        else:
            expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        
        # Add standard claims
        to_encode.update({
            "exp": expire,
            "iat": datetime.now(timezone.utc),
            "iss": settings.APP_NAME,
            "aud": settings.APP_DOMAIN,
            "jti": generate_secure_id(),  # JWT ID for tracking
            "offline_capable": offline_capable,  # For offline functionality
        })
        
        # Create token with enhanced security
        token = jwt.encode(
            to_encode, 
            settings.SECRET_KEY, 
            algorithm=settings.JWT_ALGORITHM,
            headers={"typ": "JWT", "alg": settings.JWT_ALGORITHM}
        )
        
        return token
    
    @staticmethod
    def create_refresh_token(user_id: str, device_fingerprint: str) -> str:
        """Create refresh token for long-term authentication"""
        payload = {
            "user_id": user_id,
            "device_fingerprint": device_fingerprint,
            "token_type": "refresh",
            "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
            "iat": datetime.now(timezone.utc),
            "jti": generate_secure_id(),
        }
        
        return jwt.encode(payload, settings.REFRESH_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    
    @staticmethod
    def verify_token(token: str, token_type: str = "access") -> Dict[str, Any]:
        """Verify and decode JWT token with enhanced validation"""
        try:
            secret_key = settings.SECRET_KEY if token_type == "access" else settings.REFRESH_SECRET_KEY
            
            payload = jwt.decode(
                token,
                secret_key,
                algorithms=[settings.JWT_ALGORITHM],
                audience=settings.APP_DOMAIN,
                issuer=settings.APP_NAME,
                options={
                    "verify_exp": True,
                    "verify_iat": True,
                    "verify_aud": True,
                    "verify_iss": True,
                }
            )
            
            return payload
            
        except jwt.ExpiredSignatureError:
            raise AuthError("Token has expired", "TOKEN_EXPIRED")
        except jwt.InvalidTokenError:
            raise AuthError("Invalid token", "INVALID_TOKEN")
        except jwt.InvalidAudienceError:
            raise AuthError("Invalid token audience", "INVALID_AUDIENCE")
        except jwt.InvalidIssuerError:
            raise AuthError("Invalid token issuer", "INVALID_ISSUER")
        except Exception as e:
            raise AuthError(f"Token verification failed: {str(e)}", "TOKEN_VERIFICATION_FAILED")

class OfflineAuthManager:
    """Offline authentication capabilities for better UX"""
    
    @staticmethod
    def create_offline_token(user_data: Dict[str, Any]) -> str:
        """Create extended offline token for offline app usage"""
        offline_data = {
            "user_id": user_data["user_id"],
            "subscription_tier": user_data["subscription_tier"],
            "offline_features": user_data.get("offline_features", []),
            "offline_content_limit": user_data.get("offline_content_limit", 10),
            "exp": datetime.now(timezone.utc) + timedelta(days=7),  # 7 days offline
            "offline_mode": True,
        }
        
        return TokenManager.create_access_token(offline_data, offline_capable=True)
    
    @staticmethod
    def validate_offline_access(token_payload: Dict[str, Any], requested_feature: str) -> bool:
        """Validate if user can access feature offline"""
        if not token_payload.get("offline_mode"):
            return False
        
        offline_features = token_payload.get("offline_features", [])
        
        # Define offline accessible features by tier
        tier_offline_features = {
            "freemium": ["content_generator", "basic_templates", "local_drafts"],
            "premium": ["content_generator", "ai_influencer", "templates", "bulk_operations", "local_analytics"],
            "enterprise": ["all_features"]  # Enterprise gets full offline access
        }
        
        user_tier = token_payload.get("subscription_tier", "freemium")
        allowed_features = tier_offline_features.get(user_tier, [])
        
        return (requested_feature in allowed_features or 
                "all_features" in allowed_features or 
                requested_feature in offline_features)

class SessionManager:
    """Advanced session management with device tracking"""
    
    @staticmethod
    def create_session(
        db: Session, 
        user_id: str, 
        device_fingerprint: str, 
        request: Request
    ) -> UserSession:
        """Create new user session with comprehensive tracking"""
        
        # Limit concurrent sessions per user
        active_sessions = db.query(UserSession).filter(
            UserSession.user_id == user_id,
            UserSession.is_active == True
        ).count()
        
        if active_sessions >= settings.MAX_CONCURRENT_SESSIONS:
            # Deactivate oldest session
            oldest_session = db.query(UserSession).filter(
                UserSession.user_id == user_id,
                UserSession.is_active == True
            ).order_by(UserSession.created_at).first()
            
            if oldest_session:
                oldest_session.is_active = False
                oldest_session.ended_at = datetime.now(timezone.utc)
                oldest_session.end_reason = "max_sessions_exceeded"
        
        # Create new session
        session = UserSession(
            id=generate_secure_id(),
            user_id=user_id,
            device_fingerprint=device_fingerprint,
            ip_address=get_client_ip(request),
            user_agent=request.headers.get("user-agent", ""),
            created_at=datetime.now(timezone.utc),
            last_activity=datetime.now(timezone.utc),
            is_active=True,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=SESSION_TIMEOUT_HOURS)
        )
        
        db.add(session)
        db.commit()
        db.refresh(session)
        
        return session
    
    @staticmethod
    def update_session_activity(db: Session, session_id: str) -> bool:
        """Update session last activity timestamp"""
        session = db.query(UserSession).filter(UserSession.id == session_id).first()
        if session and session.is_active:
            session.last_activity = datetime.now(timezone.utc)
            
            # Check if session expired
            if session.expires_at < datetime.now(timezone.utc):
                session.is_active = False
                session.ended_at = datetime.now(timezone.utc)
                session.end_reason = "timeout"
                db.commit()
                return False
            
            db.commit()
            return True
        return False
    
    @staticmethod
    def end_session(db: Session, session_id: str, reason: str = "logout"):
        """End user session"""
        session = db.query(UserSession).filter(UserSession.id == session_id).first()
        if session:
            session.is_active = False
            session.ended_at = datetime.now(timezone.utc)
            session.end_reason = reason
            db.commit()

class RateLimiter:
    """Advanced rate limiting for API protection"""
    
    def __init__(self):
        self.attempts = {}  # In production, use Redis
    
    def is_rate_limited(self, identifier: str, max_attempts: int = 10, window_minutes: int = 1) -> bool:
        """Check if request should be rate limited"""
        now = time.time()
        window_start = now - (window_minutes * 60)
        
        if identifier not in self.attempts:
            self.attempts[identifier] = []
        
        # Clean old attempts
        self.attempts[identifier] = [
            attempt for attempt in self.attempts[identifier] 
            if attempt > window_start
        ]
        
        # Check if limit exceeded
        if len(self.attempts[identifier]) >= max_attempts:
            return True
        
        # Record this attempt
        self.attempts[identifier].append(now)
        return False
    
    def clear_attempts(self, identifier: str):
        """Clear rate limiting attempts for identifier"""
        if identifier in self.attempts:
            del self.attempts[identifier]

# Initialize components
security_manager = SecurityManager()
token_manager = TokenManager()
offline_auth_manager = OfflineAuthManager()
session_manager = SessionManager()
rate_limiter = RateLimiter()

class AuthService:
    """Main authentication service with all security features"""
    
    @staticmethod
    def authenticate_user(db: Session, email: str, password: str, request: Request) -> Dict[str, Any]:
        """Authenticate user with comprehensive security checks"""
        
        # Rate limiting by IP
        client_ip = get_client_ip(request)
        if rate_limiter.is_rate_limited(f"login:{client_ip}", max_attempts=MAX_FAILED_ATTEMPTS, window_minutes=15):
            raise AuthError("Too many login attempts. Please try again later.", "RATE_LIMITED")
        
        # Validate email format
        if not validate_email(email):
            raise AuthError("Invalid email format", "INVALID_EMAIL")
        
        # Get user from database
        user = db.query(User).filter(User.email == email).first()
        
        if not user:
            # Log failed attempt
            AuthService._log_security_event(db, "login_failed", {"email": email, "ip": client_ip, "reason": "user_not_found"})
            raise AuthError("Invalid credentials", "INVALID_CREDENTIALS")
        
        # Check if account is locked
        if user.is_locked and user.locked_until and user.locked_until > datetime.now(timezone.utc):
            remaining_time = (user.locked_until - datetime.now(timezone.utc)).seconds // 60
            raise AuthError(f"Account locked. Try again in {remaining_time} minutes.", "ACCOUNT_LOCKED")
        
        # Verify password
        if not security_manager.verify_password(password, user.password_hash):
            # Increment failed attempts
            user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
            
            if user.failed_login_attempts >= MAX_FAILED_ATTEMPTS:
                user.is_locked = True
                user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=LOCKOUT_DURATION_MINUTES)
                
                # Log security event
                AuthService._log_security_event(db, "account_locked", {
                    "user_id": user.id, 
                    "ip": client_ip, 
                    "failed_attempts": user.failed_login_attempts
                })
            
            db.commit()
            AuthService._log_security_event(db, "login_failed", {"user_id": user.id, "ip": client_ip, "reason": "invalid_password"})
            raise AuthError("Invalid credentials", "INVALID_CREDENTIALS")
        
        # Check if account is active
        if not user.is_active:
            AuthService._log_security_event(db, "login_failed", {"user_id": user.id, "ip": client_ip, "reason": "account_inactive"})
            raise AuthError("Account is inactive", "ACCOUNT_INACTIVE")
        
        # Reset failed attempts on successful login
        user.failed_login_attempts = 0
        user.is_locked = False
        user.locked_until = None
        user.last_login = datetime.now(timezone.utc)
        
        # Generate device fingerprint
        device_fingerprint = security_manager.generate_device_fingerprint(request)
        
        # Create session
        session = session_manager.create_session(db, user.id, device_fingerprint, request)
        
        # Prepare token data
        token_data = {
            "user_id": user.id,
            "email": user.email,
            "subscription_tier": user.subscription_tier,
            "session_id": session.id,
            "device_fingerprint": device_fingerprint,
            "offline_features": AuthService._get_offline_features(user.subscription_tier),
            "offline_content_limit": AuthService._get_offline_content_limit(user.subscription_tier),
        }
        
        # Create tokens
        access_token = token_manager.create_access_token(token_data)
        refresh_token = token_manager.create_refresh_token(user.id, device_fingerprint)
        offline_token = offline_auth_manager.create_offline_token(token_data)
        
        # Store refresh token
        refresh_token_record = RefreshToken(
            id=generate_secure_id(),
            user_id=user.id,
            token_hash=hashlib.sha256(refresh_token.encode()).hexdigest(),
            device_fingerprint=device_fingerprint,
            expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
            created_at=datetime.now(timezone.utc)
        )
        db.add(refresh_token_record)
        
        db.commit()
        
        # Log successful login
        AuthService._log_security_event(db, "login_success", {
            "user_id": user.id, 
            "ip": client_ip, 
            "device_fingerprint": device_fingerprint
        })
        
        # Clear rate limiting
        rate_limiter.clear_attempts(f"login:{client_ip}")
        
        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "offline_token": offline_token,
            "token_type": "bearer",
            "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            "user": {
                "id": user.id,
                "email": user.email,
                "name": user.name,
                "subscription_tier": user.subscription_tier,
                "profile_image": user.profile_image,
                "preferences": user.preferences or {},
                "offline_capabilities": True,
            }
        }
    
    @staticmethod
    def refresh_access_token(db: Session, refresh_token: str, request: Request) -> Dict[str, Any]:
        """Refresh access token using refresh token"""
        try:
            # Verify refresh token
            payload = token_manager.verify_token(refresh_token, "refresh")
            user_id = payload["user_id"]
            device_fingerprint = payload["device_fingerprint"]
            
            # Check if refresh token exists in database
            token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
            stored_token = db.query(RefreshToken).filter(
                RefreshToken.token_hash == token_hash,
                RefreshToken.user_id == user_id,
                RefreshToken.is_valid == True,
                RefreshToken.expires_at > datetime.now(timezone.utc)
            ).first()
            
            if not stored_token:
                raise AuthError("Invalid refresh token", "INVALID_REFRESH_TOKEN")
            
            # Verify device fingerprint
            current_fingerprint = security_manager.generate_device_fingerprint(request)
            if device_fingerprint != current_fingerprint:
                # Log potential security issue
                AuthService._log_security_event(db, "device_fingerprint_mismatch", {
                    "user_id": user_id,
                    "stored_fingerprint": device_fingerprint,
                    "current_fingerprint": current_fingerprint,
                    "ip": get_client_ip(request)
                })
                raise AuthError("Device fingerprint mismatch", "DEVICE_MISMATCH")
            
            # Get user
            user = db.query(User).filter(User.id == user_id).first()
            if not user or not user.is_active:
                raise AuthError("User not found or inactive", "USER_INACTIVE")
            
            # Create new access token
            token_data = {
                "user_id": user.id,
                "email": user.email,
                "subscription_tier": user.subscription_tier,
                "device_fingerprint": device_fingerprint,
                "offline_features": AuthService._get_offline_features(user.subscription_tier),
                "offline_content_limit": AuthService._get_offline_content_limit(user.subscription_tier),
            }
            
            new_access_token = token_manager.create_access_token(token_data)
            
            return {
                "access_token": new_access_token,
                "token_type": "bearer",
                "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            }
            
        except AuthError:
            raise
        except Exception as e:
            raise AuthError(f"Token refresh failed: {str(e)}", "TOKEN_REFRESH_FAILED")
    
    @staticmethod
    def logout_user(db: Session, user_id: str, session_id: str, refresh_token: str = None):
        """Logout user and invalidate tokens"""
        # End session
        if session_id:
            session_manager.end_session(db, session_id, "logout")
        
        # Invalidate refresh token
        if refresh_token:
            token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
            stored_token = db.query(RefreshToken).filter(
                RefreshToken.token_hash == token_hash,
                RefreshToken.user_id == user_id
            ).first()
            
            if stored_token:
                stored_token.is_valid = False
                stored_token.revoked_at = datetime.now(timezone.utc)
        
        db.commit()
        
        # Log logout
        AuthService._log_security_event(db, "logout", {"user_id": user_id})
    
    @staticmethod
    def _get_offline_features(subscription_tier: str) -> List[str]:
        """Get offline features based on subscription tier"""
        features = {
            "freemium": ["content_generator", "basic_templates", "local_drafts"],
            "premium": ["content_generator", "ai_influencer", "templates", "bulk_operations", "local_analytics"],
            "enterprise": ["all_features"]
        }
        return features.get(subscription_tier, features["freemium"])
    
    @staticmethod
    def _get_offline_content_limit(subscription_tier: str) -> int:
        """Get offline content generation limit"""
        limits = {
            "freemium": 10,
            "premium": 100,
            "enterprise": 1000
        }
        return limits.get(subscription_tier, 10)
    
    @staticmethod
    def _log_security_event(db: Session, event_type: str, data: Dict[str, Any]):
        """Log security events for monitoring"""
        try:
            security_log = SecurityLog(
                id=generate_secure_id(),
                event_type=event_type,
                event_data=data,
                timestamp=datetime.now(timezone.utc),
                ip_address=data.get("ip", "unknown"),
                user_id=data.get("user_id")
            )
            db.add(security_log)
            db.commit()
        except Exception as e:
            # Don't fail main operation if logging fails
            print(f"Failed to log security event: {e}")

# Authentication Dependency
async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """FastAPI dependency to get current authenticated user"""
    
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    try:
        # Verify access token
        payload = token_manager.verify_token(credentials.credentials)
        
        # Check if session is still active
        session_id = payload.get("session_id")
        if session_id:
            if not session_manager.update_session_activity(db, session_id):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Session expired",
                    headers={"WWW-Authenticate": "Bearer"},
                )
        
        # Verify device fingerprint for additional security
        stored_fingerprint = payload.get("device_fingerprint")
        current_fingerprint = security_manager.generate_device_fingerprint(request)
        
        # Allow some flexibility for mobile devices
        if stored_fingerprint and stored_fingerprint != current_fingerprint:
            # Log potential security issue but don't block (mobile devices can change fingerprints)
            AuthService._log_security_event(db, "fingerprint_change", {
                "user_id": payload.get("user_id"),
                "old_fingerprint": stored_fingerprint,
                "new_fingerprint": current_fingerprint,
                "ip": get_client_ip(request)
            })
        
        return payload
        
    except AuthError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=e.message,
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

# Offline Authentication Dependency
async def get_offline_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """Authentication dependency that supports offline tokens"""
    
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    
    try:
        # Try to verify as regular token first
        payload = token_manager.verify_token(credentials.credentials)
        
        # If it's an offline token, validate offline access
        if payload.get("offline_mode"):
            return payload
        
        # For online tokens, check session as usual
        session_id = payload.get("session_id")
        if session_id and not session_manager.update_session_activity(db, session_id):
            # If session expired but token is offline-capable, allow offline access
            if payload.get("offline_capable"):
                payload["offline_mode"] = True
                return payload
            
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired",
            )
        
        return payload
        
    except AuthError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=e.message,
        )

# Role-based Access Control
def require_subscription_tier(required_tier: str):
    """Decorator to require specific subscription tier"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Get current user from kwargs (should be injected by dependency)
            current_user = kwargs.get('current_user')
            if not current_user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Authentication required"
                )
            
            user_tier = current_user.get("subscription_tier", "freemium")
            
            # Define tier hierarchy
            tier_levels = {"freemium": 0, "premium": 1, "enterprise": 2}
            
            if tier_levels.get(user_tier, 0) < tier_levels.get(required_tier, 0):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Subscription tier '{required_tier}' required"
                )
            
            return await func(*args, **kwargs)
        return wrapper
    return decorator

# Feature Access Control for Offline Mode
def require_offline_feature(feature_name: str):
    """Decorator to check offline feature access"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            current_user = kwargs.get('current_user')
            if not current_user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Authentication required"
                )
            
            # Check if user can access this feature offline
            if current_user.get("offline_mode"):
                if not offline_auth_manager.validate_offline_access(current_user, feature_name):
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=f"Feature '{feature_name}' not available offline for your subscription tier"
                    )
            
            return await func(*args, **kwargs)
        return wrapper
    return decorator

# Export main components
__all__ = [
    "AuthService",
    "get_current_user",
    "get_offline_user",
    "require_subscription_tier",
    "require_offline_feature",
    "SecurityManager",
    "TokenManager",
    "OfflineAuthManager",
    "SessionManager",
    "RateLimiter",
    "AuthError"
]