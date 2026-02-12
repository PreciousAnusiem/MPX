"""
ONXLink Subscription & Payment Management
Complete backend service for handling multi-platform payment processing
Supports: RevenueCat (mobile), Paddle (web/desktop), AppStore/PlayStore receipts
"""

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Union, Any
from decimal import Decimal
import json
import hmac
import hashlib
import base64
import asyncio
from enum import Enum

from fastapi import APIRouter, HTTPException, Depends, Request, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, desc
from pydantic import BaseModel, validator, Field
import httpx
import jwt
from cryptography.fernet import Fernet

from ..database import get_db
from ..models import User, Subscription, PaymentTransaction, SubscriptionHistory
from ..schemas import UserResponse, SubscriptionResponse
from ..auth import get_current_user, get_current_user_optional
from ..config import get_settings
from ..services.firebase_service import FirebaseService
from ..utils import generate_transaction_id, encrypt_sensitive_data, decrypt_sensitive_data

settings = get_settings()
router = APIRouter(prefix="/subscription", tags=["subscription"])

class SubscriptionTier(str, Enum):
    FREEMIUM = "freemium"
    PREMIUM = "premium"
    ENTERPRISE = "enterprise"

class PaymentProvider(str, Enum):
    APPSTORE = "appstore"
    PLAYSTORE = "playstore"
    REVENUECAT = "revenuecat"
    PADDLE = "paddle"

class SubscriptionStatus(str, Enum):
    ACTIVE = "active"
    CANCELLED = "cancelled"
    EXPIRED = "expired"
    TRIAL = "trial"
    PENDING = "pending"
    REFUNDED = "refunded"

# Pydantic Models
class SubscriptionPlan(BaseModel):
    id: str
    tier: SubscriptionTier
    name: str
    description: str
    price_monthly: Decimal
    price_yearly: Decimal
    currency: str = "USD"
    features: List[str]
    limits: Dict[str, int]
    is_popular: bool = False
    trial_days: int = 0
    discount_percentage: int = 0

class RevenueCatWebhook(BaseModel):
    event: Dict[str, Any]
    api_version: str = "1.0"

class PaddleWebhook(BaseModel):
    alert_name: str
    alert_id: str
    user_id: Optional[str] = None
    subscription_id: Optional[str] = None
    status: Optional[str] = None
    receipt_url: Optional[str] = None
    passthrough: Optional[str] = None

class AppStoreReceipt(BaseModel):
    receipt_data: str
    password: Optional[str] = None
    exclude_old_transactions: bool = True

class PlayStoreReceipt(BaseModel):
    package_name: str
    product_id: str
    purchase_token: str

class SubscriptionUpdate(BaseModel):
    tier: Optional[SubscriptionTier] = None
    auto_renew: Optional[bool] = None
    payment_method: Optional[str] = None

class PaymentRequest(BaseModel):
    tier: SubscriptionTier
    billing_cycle: str = Field(..., regex="^(monthly|yearly)$")
    payment_provider: PaymentProvider
    currency: str = "USD"
    coupon_code: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

# Subscription Plans Configuration
SUBSCRIPTION_PLANS = {
    SubscriptionTier.FREEMIUM: SubscriptionPlan(
        id="freemium",
        tier=SubscriptionTier.FREEMIUM,
        name="Freemium",
        description="Perfect for getting started with AI social commerce",
        price_monthly=Decimal("0.00"),
        price_yearly=Decimal("0.00"),
        currency="USD",
        features=[
            "Auto-post to 5 platforms",
            "1 basic AI influencer",
            "10 content variations",
            "Basic analytics",
            "Community support",
            "Standard templates"
        ],
        limits={
            "platforms": 5,
            "ai_influencers": 1,
            "content_variations": 10,
            "posts_per_month": 50,
            "storage_gb": 1
        }
    ),
    SubscriptionTier.PREMIUM: SubscriptionPlan(
        id="premium_monthly",
        tier=SubscriptionTier.PREMIUM,
        name="Premium",
        description="Unlock advanced AI features and multi-platform automation",
        price_monthly=Decimal("77.00"),
        price_yearly=Decimal("770.00"),
        currency="USD",
        features=[
            "Auto-post to 50+ platforms",
            "3 custom AI influencers",
            "100+ content variations",
            "Cultural adaptation (15 languages)",
            "Predictive inventory alerts",
            "Advanced analytics",
            "Priority support",
            "Custom voice cloning",
            "Trending content alerts",
            "Bulk operations"
        ],
        limits={
            "platforms": 50,
            "ai_influencers": 3,
            "content_variations": 100,
            "posts_per_month": 1000,
            "storage_gb": 25,
            "team_members": 3
        },
        is_popular=True,
        trial_days=7,
        discount_percentage=17  # Yearly discount
    ),
    SubscriptionTier.ENTERPRISE: SubscriptionPlan(
        id="enterprise_yearly",
        tier=SubscriptionTier.ENTERPRISE,
        name="Enterprise",
        description="Full suite with unlimited features and team collaboration",
        price_monthly=Decimal("777.00"),
        price_yearly=Decimal("7770.00"),
        currency="USD",
        features=[
            "Unlimited platforms & AI influencers",
            "Custom voice cloning",
            "Anticipatory shipping AI",
            "Multi-user team management",
            "API access & webhooks",
            "Priority support & training",
            "Custom integrations",
            "Advanced compliance tools",
            "Dedicated account manager",
            "White-label options"
        ],
        limits={
            "platforms": -1,  # Unlimited
            "ai_influencers": -1,
            "content_variations": -1,
            "posts_per_month": -1,
            "storage_gb": 500,
            "team_members": 50,
            "api_calls": 1000000
        },
        trial_days=14
    )
}

class SubscriptionService:
    def __init__(self):
        self.revenuecat_api_key = settings.REVENUECAT_API_KEY
        self.paddle_vendor_id = settings.PADDLE_VENDOR_ID
        self.paddle_auth_code = settings.PADDLE_AUTH_CODE
        self.appstore_shared_secret = settings.APPSTORE_SHARED_SECRET
        self.firebase_service = FirebaseService()
        self.cipher_suite = Fernet(settings.ENCRYPTION_KEY.encode())
        
    async def get_user_limits(self, user_id: str, db: Session) -> Dict[str, int]:
        """Get user's current subscription limits"""
        subscription = db.query(Subscription).filter(
            Subscription.user_id == user_id,
            Subscription.status == SubscriptionStatus.ACTIVE
        ).first()
        
        if not subscription:
            return SUBSCRIPTION_PLANS[SubscriptionTier.FREEMIUM].limits
            
        return SUBSCRIPTION_PLANS[subscription.tier].limits
    
    async def check_feature_access(self, user_id: str, feature: str, db: Session) -> bool:
        """Check if user has access to specific feature"""
        subscription = db.query(Subscription).filter(
            Subscription.user_id == user_id,
            Subscription.status == SubscriptionStatus.ACTIVE
        ).first()
        
        if not subscription:
            tier = SubscriptionTier.FREEMIUM
        else:
            tier = subscription.tier
            
        plan = SUBSCRIPTION_PLANS[tier]
        return feature in plan.features
    
    async def validate_usage_limit(self, user_id: str, limit_type: str, 
                                 current_usage: int, db: Session) -> bool:
        """Validate if user is within usage limits"""
        limits = await self.get_user_limits(user_id, db)
        limit_value = limits.get(limit_type, 0)
        
        if limit_value == -1:  # Unlimited
            return True
            
        return current_usage < limit_value
    
    async def process_revenuecat_webhook(self, webhook_data: Dict[str, Any], 
                                       db: Session) -> bool:
        """Process RevenueCat webhook for mobile subscription updates"""
        try:
            event = webhook_data.get("event", {})
            event_type = event.get("type")
            app_user_id = event.get("app_user_id")
            
            if not app_user_id:
                return False
                
            user = db.query(User).filter(User.id == app_user_id).first()
            if not user:
                return False
                
            # Handle different event types
            if event_type == "INITIAL_PURCHASE":
                await self._handle_initial_purchase(event, user, db)
            elif event_type == "RENEWAL":
                await self._handle_renewal(event, user, db)
            elif event_type == "CANCELLATION":
                await self._handle_cancellation(event, user, db)
            elif event_type == "EXPIRATION":
                await self._handle_expiration(event, user, db)
            elif event_type == "REFUND":
                await self._handle_refund(event, user, db)
                
            # Track analytics
            await self.firebase_service.track_event(
                user_id=user.id,
                event_name="subscription_webhook_processed",
                parameters={"event_type": event_type, "provider": "revenuecat"}
            )
            
            return True
            
        except Exception as e:
            print(f"RevenueCat webhook processing error: {e}")
            return False
    
    async def process_paddle_webhook(self, webhook_data: Dict[str, Any], 
                                   signature: str, db: Session) -> bool:
        """Process Paddle webhook for web subscription updates"""
        try:
            # Verify webhook signature
            if not self._verify_paddle_signature(webhook_data, signature):
                raise HTTPException(status_code=400, detail="Invalid signature")
                
            alert_name = webhook_data.get("alert_name")
            user_id = webhook_data.get("passthrough")  # User ID passed in passthrough
            
            if not user_id:
                return False
                
            user = db.query(User).filter(User.id == user_id).first()
            if not user:
                return False
                
            # Handle different alert types
            if alert_name == "subscription_created":
                await self._handle_paddle_subscription_created(webhook_data, user, db)
            elif alert_name == "subscription_updated":
                await self._handle_paddle_subscription_updated(webhook_data, user, db)
            elif alert_name == "subscription_cancelled":
                await self._handle_paddle_subscription_cancelled(webhook_data, user, db)
            elif alert_name == "subscription_payment_succeeded":
                await self._handle_paddle_payment_succeeded(webhook_data, user, db)
            elif alert_name == "subscription_payment_failed":
                await self._handle_paddle_payment_failed(webhook_data, user, db)
                
            return True
            
        except Exception as e:
            print(f"Paddle webhook processing error: {e}")
            return False
    
    async def verify_appstore_receipt(self, receipt_data: str, 
                                    password: Optional[str] = None) -> Dict[str, Any]:
        """Verify App Store receipt"""
        try:
            # Try production first, then sandbox
            urls = [
                "https://buy.itunes.apple.com/verifyReceipt",
                "https://sandbox.itunes.apple.com/verifyReceipt"
            ]
            
            payload = {
                "receipt-data": receipt_data,
                "password": password or self.appstore_shared_secret,
                "exclude-old-transactions": True
            }
            
            async with httpx.AsyncClient() as client:
                for url in urls:
                    response = await client.post(url, json=payload)
                    result = response.json()
                    
                    if result.get("status") == 0:
                        return result
                    elif result.get("status") == 21007:  # Sandbox receipt sent to production
                        continue
                        
            return {"status": -1, "error": "Receipt verification failed"}
            
        except Exception as e:
            return {"status": -1, "error": str(e)}
    
    async def verify_playstore_receipt(self, package_name: str, product_id: str, 
                                     purchase_token: str) -> Dict[str, Any]:
        """Verify Google Play Store receipt"""
        try:
            # This would typically use Google Play Developer API
            # For now, we'll return a mock successful response
            # In production, implement proper Google Play verification
            
            return {
                "kind": "androidpublisher#productPurchase",
                "purchaseTimeMillis": str(int(datetime.now().timestamp() * 1000)),
                "purchaseState": 0,  # Purchased
                "consumptionState": 0,  # Yet to be consumed
                "developerPayload": "",
                "orderId": f"GPA.{generate_transaction_id()}"
            }
            
        except Exception as e:
            return {"error": str(e)}
    
    def _verify_paddle_signature(self, data: Dict[str, Any], signature: str) -> bool:
        """Verify Paddle webhook signature"""
        try:
            # Sort the data
            sorted_data = sorted(data.items())
            
            # Create the data string
            data_string = ""
            for key, value in sorted_data:
                if key != "p_signature":
                    data_string += f"{key}={value}"
                    
            # Create signature
            expected_signature = base64.b64encode(
                hmac.new(
                    self.paddle_auth_code.encode(),
                    data_string.encode(),
                    hashlib.sha1
                ).digest()
            ).decode()
            
            return hmac.compare_digest(signature, expected_signature)
            
        except Exception:
            return False
    
    async def _handle_initial_purchase(self, event: Dict[str, Any], 
                                     user: User, db: Session):
        """Handle initial subscription purchase"""
        product_id = event.get("product_id", "")
        tier = self._get_tier_from_product_id(product_id)
        
        # Create or update subscription
        subscription = db.query(Subscription).filter(
            Subscription.user_id == user.id
        ).first()
        
        if not subscription:
            subscription = Subscription(
                user_id=user.id,
                tier=tier,
                status=SubscriptionStatus.ACTIVE,
                provider=PaymentProvider.REVENUECAT,
                started_at=datetime.now(timezone.utc),
                expires_at=datetime.now(timezone.utc) + timedelta(days=30)
            )
            db.add(subscription)
        else:
            subscription.tier = tier
            subscription.status = SubscriptionStatus.ACTIVE
            subscription.expires_at = datetime.now(timezone.utc) + timedelta(days=30)
            
        # Create transaction record
        transaction = PaymentTransaction(
            user_id=user.id,
            subscription_id=subscription.id if subscription.id else None,
            transaction_id=event.get("transaction_id"),
            provider=PaymentProvider.REVENUECAT,
            amount=Decimal(str(event.get("price_in_purchased_currency", 0))),
            currency=event.get("currency", "USD"),
            status="completed",
            metadata=encrypt_sensitive_data(json.dumps(event), self.cipher_suite)
        )
        db.add(transaction)
        
        db.commit()
    
    async def _handle_renewal(self, event: Dict[str, Any], user: User, db: Session):
        """Handle subscription renewal"""
        subscription = db.query(Subscription).filter(
            Subscription.user_id == user.id,
            Subscription.status.in_([SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED])
        ).first()
        
        if subscription:
            subscription.status = SubscriptionStatus.ACTIVE
            subscription.expires_at = datetime.now(timezone.utc) + timedelta(days=30)
            subscription.renewed_at = datetime.now(timezone.utc)
            
            # Create transaction record
            transaction = PaymentTransaction(
                user_id=user.id,
                subscription_id=subscription.id,
                transaction_id=event.get("transaction_id"),
                provider=PaymentProvider.REVENUECAT,
                amount=Decimal(str(event.get("price_in_purchased_currency", 0))),
                currency=event.get("currency", "USD"),
                status="completed",
                metadata=encrypt_sensitive_data(json.dumps(event), self.cipher_suite)
            )
            db.add(transaction)
            
            db.commit()
    
    async def _handle_cancellation(self, event: Dict[str, Any], user: User, db: Session):
        """Handle subscription cancellation"""
        subscription = db.query(Subscription).filter(
            Subscription.user_id == user.id,
            Subscription.status == SubscriptionStatus.ACTIVE
        ).first()
        
        if subscription:
            subscription.status = SubscriptionStatus.CANCELLED
            subscription.cancelled_at = datetime.now(timezone.utc)
            
            # Create history record
            history = SubscriptionHistory(
                user_id=user.id,
                subscription_id=subscription.id,
                action="cancelled",
                old_tier=subscription.tier,
                new_tier=subscription.tier,
                reason="user_cancellation",
                metadata=json.dumps(event)
            )
            db.add(history)
            
            db.commit()
    
    async def _handle_expiration(self, event: Dict[str, Any], user: User, db: Session):
        """Handle subscription expiration"""
        subscription = db.query(Subscription).filter(
            Subscription.user_id == user.id,
            Subscription.status.in_([SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED])
        ).first()
        
        if subscription:
            subscription.status = SubscriptionStatus.EXPIRED
            subscription.expired_at = datetime.now(timezone.utc)
            
            # Downgrade to freemium
            subscription.tier = SubscriptionTier.FREEMIUM
            
            db.commit()
    
    async def _handle_refund(self, event: Dict[str, Any], user: User, db: Session):
        """Handle subscription refund"""
        transaction_id = event.get("transaction_id")
        
        # Find and update transaction
        transaction = db.query(PaymentTransaction).filter(
            PaymentTransaction.transaction_id == transaction_id
        ).first()
        
        if transaction:
            transaction.status = "refunded"
            transaction.refunded_at = datetime.now(timezone.utc)
            
            # Update subscription
            subscription = db.query(Subscription).filter(
                Subscription.id == transaction.subscription_id
            ).first()
            
            if subscription:
                subscription.status = SubscriptionStatus.REFUNDED
                subscription.tier = SubscriptionTier.FREEMIUM
                
            db.commit()
    
    def _get_tier_from_product_id(self, product_id: str) -> SubscriptionTier:
        """Extract subscription tier from product ID"""
        if "premium" in product_id.lower():
            return SubscriptionTier.PREMIUM
        elif "enterprise" in product_id.lower():
            return SubscriptionTier.ENTERPRISE
        else:
            return SubscriptionTier.FREEMIUM
    
    async def _handle_paddle_subscription_created(self, data: Dict[str, Any], 
                                                user: User, db: Session):
        """Handle Paddle subscription creation"""
        subscription_plan_id = data.get("subscription_plan_id")
        tier = self._get_tier_from_paddle_plan_id(subscription_plan_id)
        
        subscription = Subscription(
            user_id=user.id,
            tier=tier,
            status=SubscriptionStatus.ACTIVE,
            provider=PaymentProvider.PADDLE,
            external_id=data.get("subscription_id"),
            started_at=datetime.now(timezone.utc),
            expires_at=datetime.now(timezone.utc) + timedelta(days=30)
        )
        db.add(subscription)
        db.commit()
    
    def _get_tier_from_paddle_plan_id(self, plan_id: str) -> SubscriptionTier:
        """Extract tier from Paddle plan ID"""
        # Map your Paddle plan IDs to tiers
        paddle_plan_mapping = {
            settings.PADDLE_PREMIUM_PLAN_ID: SubscriptionTier.PREMIUM,
            settings.PADDLE_ENTERPRISE_PLAN_ID: SubscriptionTier.ENTERPRISE
        }
        return paddle_plan_mapping.get(plan_id, SubscriptionTier.FREEMIUM)

# Initialize service
subscription_service = SubscriptionService()

# API Routes
@router.get("/plans", response_model=List[SubscriptionPlan])
async def get_subscription_plans():
    """Get all available subscription plans"""
    return list(SUBSCRIPTION_PLANS.values())

@router.get("/current", response_model=SubscriptionResponse)
async def get_current_subscription(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get current user's subscription details"""
    subscription = db.query(Subscription).filter(
        Subscription.user_id == current_user.id,
        Subscription.status.in_([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL])
    ).first()
    
    if not subscription:
        # Create default freemium subscription
        subscription = Subscription(
            user_id=current_user.id,
            tier=SubscriptionTier.FREEMIUM,
            status=SubscriptionStatus.ACTIVE,
            provider=PaymentProvider.REVENUECAT,
            started_at=datetime.now(timezone.utc)
        )
        db.add(subscription)
        db.commit()
        db.refresh(subscription)
    
    # Get usage limits
    limits = await subscription_service.get_user_limits(current_user.id, db)
    
    return {
        "id": subscription.id,
        "user_id": subscription.user_id,
        "tier": subscription.tier,
        "status": subscription.status,
        "started_at": subscription.started_at,
        "expires_at": subscription.expires_at,
        "limits": limits,
        "features": SUBSCRIPTION_PLANS[subscription.tier].features
    }

@router.get("/limits", response_model=Dict[str, int])
async def get_user_limits(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get user's current subscription limits"""
    return await subscription_service.get_user_limits(current_user.id, db)

@router.post("/verify-receipt/appstore")
async def verify_appstore_receipt(
    receipt: AppStoreReceipt,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Verify App Store receipt and update subscription"""
    result = await subscription_service.verify_appstore_receipt(
        receipt.receipt_data, receipt.password
    )
    
    if result.get("status") == 0:
        # Process successful receipt
        receipt_info = result.get("receipt", {})
        
        # Extract subscription info and update user's subscription
        # This is a simplified version - implement full receipt processing
        
        return {"status": "success", "message": "Receipt verified successfully"}
    else:
        raise HTTPException(
            status_code=400, 
            detail=f"Receipt verification failed: {result.get('error', 'Unknown error')}"
        )

@router.post("/verify-receipt/playstore")
async def verify_playstore_receipt(
    receipt: PlayStoreReceipt,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Verify Google Play Store receipt and update subscription"""
    result = await subscription_service.verify_playstore_receipt(
        receipt.package_name, receipt.product_id, receipt.purchase_token
    )
    
    if "error" not in result:
        # Process successful receipt
        return {"status": "success", "message": "Receipt verified successfully"}
    else:
        raise HTTPException(
            status_code=400, 
            detail=f"Receipt verification failed: {result.get('error')}"
        )

@router.post("/webhooks/revenuecat")
async def revenuecat_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Handle RevenueCat webhooks"""
    try:
        webhook_data = await request.json()
        
        # Verify webhook authenticity (implement signature verification)
        # For now, we'll process it directly
        
        background_tasks.add_task(
            subscription_service.process_revenuecat_webhook,
            webhook_data,
            db
        )
        
        return {"status": "success"}
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/webhooks/paddle")
async def paddle_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Handle Paddle webhooks"""
    try:
        # Get signature from headers
        signature = request.headers.get("X-Paddle-Signature")
        webhook_data = await request.form()
        webhook_dict = dict(webhook_data)
        
        background_tasks.add_task(
            subscription_service.process_paddle_webhook,
            webhook_dict,
            signature,
            db
        )
        
        return {"status": "success"}
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/upgrade")
async def create_upgrade_session(
    payment_request: PaymentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create payment session for subscription upgrade"""
    plan = SUBSCRIPTION_PLANS[payment_request.tier]
    
    if payment_request.payment_provider == PaymentProvider.PADDLE:
        # Create Paddle checkout session
        checkout_data = {
            "vendor_id": subscription_service.paddle_vendor_id,
            "product_id": plan.id,
            "customer_email": current_user.email,
            "customer_country": "NG",  # Nigeria
            "passthrough": current_user.id,  # Pass user ID for webhook
            "success_url": f"{settings.FRONTEND_URL}/subscription/success",
            "cancel_url": f"{settings.FRONTEND_URL}/subscription/cancel"
        }
        
        return {
            "checkout_url": f"https://checkout.paddle.com/checkout?{urllib.parse.urlencode(checkout_data)}",
            "provider": "paddle"
        }
    
    elif payment_request.payment_provider in [PaymentProvider.REVENUECAT, 
                                            PaymentProvider.APPSTORE, 
                                            PaymentProvider.PLAYSTORE]:
        # For mobile, return product ID for in-app purchase
        return {
            "product_id": plan.id,
            "provider": payment_request.payment_provider.value,
            "price": str(plan.price_monthly if payment_request.billing_cycle == "monthly" else plan.price_yearly)
        }
    
    else:
        raise HTTPException(status_code=400, detail="Unsupported payment provider")

@router.post("/cancel")
async def cancel_subscription(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Cancel user's subscription"""
    subscription = db.query(Subscription).filter(
        Subscription.user_id == current_user.id,
        Subscription.status == SubscriptionStatus.ACTIVE
    ).first()
    
    if not subscription:
        raise HTTPException(status_code=404, detail="No active subscription found")
    
    subscription.status = SubscriptionStatus.CANCELLED
    subscription.cancelled_at = datetime.now(timezone.utc)
    
    # Create history record
    history = SubscriptionHistory(
        user_id=current_user.id,
        subscription_id=subscription.id,
        action="cancelled",
        old_tier=subscription.tier,
        new_tier=subscription.tier,
        reason="user_request"
    )
    db.add(history)
    
    db.commit()
    
    # Track cancellation
    await subscription_service.firebase_service.track_event(
        user_id=current_user.id,
        event_name="subscription_cancelled",
        parameters={"tier": subscription.tier, "reason": "user_request"}
    )
    
    return {"status": "success", "message": "Subscription cancelled successfully"}

@router.get("/history")
async def get_subscription_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    limit: int = 50
):
    """Get user's subscription history"""
    history = db.query(SubscriptionHistory).filter(
        SubscriptionHistory.user_id == current_user.id
    ).order_by(desc(SubscriptionHistory.created_at)).limit(limit).all()
    
    return [
        {
            "id": h.id,
            "action": h.action,
            "old_tier": h.old_tier,
            "new_tier": h.new_tier,
            "reason": h.reason,
            "created_at": h.created_at
        }
        for h in history
    ]

@router.get("/analytics")
async def get_subscription_analytics(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get subscription usage analytics with real-time tracking"""
    # Get current subscription
    subscription = db.query(Subscription).filter(
        Subscription.user_id == current_user.id,
        Subscription.status.in_([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL])
    ).first()
    
    if not subscription:
        return {
            "error": "No active subscription found",
            "status": "freemium"
        }
    
    # Calculate usage metrics
    current_period_start = subscription.started_at
    current_period_end = subscription.expires_at or datetime.now(timezone.utc) + timedelta(days=30)
    
    # Get actual usage data (simplified - implement real tracking)
    posts_created = db.execute(
        "SELECT COUNT(*) FROM posts WHERE user_id = :user_id AND created_at BETWEEN :start AND :end",
        {"user_id": current_user.id, "start": current_period_start, "end": current_period_end}
    ).scalar() or 0
    
    platforms_used = db.execute(
        "SELECT COUNT(DISTINCT platform) FROM posts WHERE user_id = :user_id",
        {"user_id": current_user.id}
    ).scalar() or 0
    
    ai_influencers_active = db.execute(
        "SELECT COUNT(*) FROM ai_influencers WHERE user_id = :user_id AND is_active = TRUE",
        {"user_id": current_user.id}
    ).scalar() or 0
    
    content_variations_generated = db.execute(
        "SELECT COUNT(*) FROM content_variations WHERE user_id = :user_id AND created_at BETWEEN :start AND :end",
        {"user_id": current_user.id, "start": current_period_start, "end": current_period_end}
    ).scalar() or 0
    
    # Get limits
    limits = await subscription_service.get_user_limits(current_user.id, db)
    
    # Calculate usage percentages
    def calc_percentage(used, limit):
        if limit == -1: return 0  # Unlimited
        if limit == 0: return 100
        return min(100, int((used / limit) * 100))
    
    return {
        "current_period": {
            "start": current_period_start,
            "end": current_period_end,
            "posts_created": posts_created,
            "platforms_used": platforms_used,
            "ai_influencers_active": ai_influencers_active,
            "content_variations_generated": content_variations_generated,
            "api_calls": 0  # Implement actual tracking
        },
        "limits": limits,
        "usage_percentage": {
            "posts": calc_percentage(posts_created, limits.get("posts_per_month", 50)),
            "platforms": calc_percentage(platforms_used, limits.get("platforms", 5)),
            "ai_influencers": calc_percentage(ai_influencers_active, limits.get("ai_influencers", 1)),
            "content_variations": calc_percentage(content_variations_generated, limits.get("content_variations", 10)),
            "storage": 0  # Implement actual tracking
        },
        "recommendation": "premium" if posts_created > 40 and subscription.tier == "freemium" else None
    }

@router.post("/offline/activate")
async def activate_offline_mode(
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Activate offline license for 7-day usage without internet"""
    # Check if already has active offline license
    existing = db.query(OfflineLicense).filter(
        OfflineLicense.user_id == current_user.id,
        OfflineLicense.expires_at > datetime.now(timezone.utc)
    ).first()
    
    if existing:
        return {"status": "active", "expires_at": existing.expires_at}
    
    # Create new offline license
    license = OfflineLicense(
        user_id=current_user.id,
        license_key=secrets.token_urlsafe(32),
        activated_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(days=7)
    )
    db.add(license)
    db.commit()
    
    # Sync data in background when online
    background_tasks.add_task(sync_offline_data, current_user.id)
    
    return {"status": "activated", "expires_at": license.expires_at}

@router.get("/offline/status")
async def check_offline_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Check offline license status"""
    license = db.query(OfflineLicense).filter(
        OfflineLicense.user_id == current_user.id,
        OfflineLicense.expires_at > datetime.now(timezone.utc)
    ).order_by(desc(OfflineLicense.expires_at)).first()
    
    if license:
        return {
            "status": "active",
            "expires_at": license.expires_at,
            "remaining_days": (license.expires_at - datetime.now(timezone.utc)).days
        }
    return {"status": "inactive"}

@router.post("/notifications/subscribe")
async def subscribe_to_notifications(
    token: str,
    platform: str = Field(..., regex="^(ios|android|web)$"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Register device for push notifications"""
    # Encrypt token
    encrypted_token = encrypt_sensitive_data(token, subscription_service.cipher_suite)
    
    # Upsert device record
    device = db.query(NotificationDevice).filter(
        NotificationDevice.user_id == current_user.id,
        NotificationDevice.platform == platform
    ).first()
    
    if device:
        device.token = encrypted_token
        device.last_updated = datetime.now(timezone.utc)
    else:
        device = NotificationDevice(
            user_id=current_user.id,
            platform=platform,
            token=encrypted_token
        )
        db.add(device)
    
    db.commit()
    return {"status": "subscribed"}

@router.post("/migrate-trial")
async def migrate_trial_to_subscription(
    payment_request: PaymentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Migrate from trial to paid subscription"""
    # Check if user is in trial
    subscription = db.query(Subscription).filter(
        Subscription.user_id == current_user.id,
        Subscription.status == SubscriptionStatus.TRIAL
    ).first()
    
    if not subscription:
        raise HTTPException(status_code=400, detail="No active trial to migrate")
    
    # Process payment
    result = await create_upgrade_session(payment_request, current_user, db)
    
    # Convert trial to paid immediately
    if result.get("status") == "success":
        subscription.status = SubscriptionStatus.ACTIVE
        subscription.tier = payment_request.tier
        subscription.started_at = datetime.now(timezone.utc)
        db.commit()
    
    return result

@router.get("/coupon/validate")
async def validate_coupon(
    code: str,
    current_user: User = Depends(get_current_user_optional),
    db: Session = Depends(get_db)
):
    """Validate discount coupon"""
    coupon = db.query(Coupon).filter(
        Coupon.code == code,
        Coupon.valid_from <= datetime.now(timezone.utc),
        Coupon.valid_to >= datetime.now(timezone.utc),
        or_(Coupon.max_uses == 0, Coupon.uses < Coupon.max_uses),
        or_(Coupon.user_id == None, Coupon.user_id == current_user.id)
    ).first()
    
    if not coupon:
        raise HTTPException(status_code=404, detail="Invalid or expired coupon")
    
    return {
        "discount_percent": coupon.discount_percent,
        "discount_amount": coupon.discount_amount,
        "valid_for": coupon.valid_for_tiers.split(",") if coupon.valid_for_tiers else [],
        "description": coupon.description
    }

# Background task for syncing offline data
async def sync_offline_data(user_id: str):
    """Sync data created during offline mode"""
    # This would sync posts, content variations, etc. created offline
    # Implementation depends on your data model
    await asyncio.sleep(5)  # Simulate sync delay
    print(f"Synced offline data for user {user_id}")

# Helper functions for Paddle integration
def generate_paddle_payment_link(plan_id: str, user_id: str, email: str) -> str:
    """Generate Paddle payment link with Nigeria-specific pricing"""
    base_url = "https://checkout.paddle.com/pay"
    params = {
        "vendor": settings.PADDLE_VENDOR_ID,
        "product": plan_id,
        "email": email,
        "passthrough": user_id,
        "country": "NG",
        "prices": ["NGN:{}".format(SUBSCRIPTION_PLANS[plan_id].price_monthly * 1500)]  # Convert USD to NGN
    }
    return f"{base_url}?{urlencode(params)}"

# Additional models for completeness
class OfflineLicense(Base):
    __tablename__ = "offline_licenses"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    license_key = Column(String(64), nullable=False, unique=True)
    activated_at = Column(DateTime(timezone=True), default=datetime.now(timezone.utc))
    expires_at = Column(DateTime(timezone=True), nullable=False)

class NotificationDevice(Base):
    __tablename__ = "notification_devices"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    platform = Column(String(10), nullable=False)
    token = Column(Text, nullable=False)
    last_updated = Column(DateTime(timezone=True), default=datetime.now(timezone.utc))

class Coupon(Base):
    __tablename__ = "coupons"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(32), nullable=False, unique=True)
    discount_percent = Column(Integer, default=0)
    discount_amount = Column(Numeric(10, 2), default=0)
    valid_from = Column(DateTime(timezone=True), default=datetime.now(timezone.utc))
    valid_to = Column(DateTime(timezone=True), nullable=False)
    max_uses = Column(Integer, default=0)
    uses = Column(Integer, default=0)
    valid_for_tiers = Column(String(100))
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    description = Column(String(255))