"""
ONXLink AI Service - Production Implementation
Handles AI content generation, caching, and offline capabilities
"""

import asyncio
import hashlib
import json
import logging
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict
from enum import Enum
import aioredis
import openai
from anthropic import AsyncAnthropic
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, insert, update, delete
from cryptography.fernet import Fernet

from ..config import settings
from ..models import User, ContentGeneration, AICache, UserSubscription
from ..utils import encrypt_data, decrypt_data, rate_limiter, log_user_activity
from ..database import get_db

# Configure logging
logger = logging.getLogger(__name__)

class ContentType(Enum):
    CAPTION = "caption"
    HASHTAGS = "hashtags"
    DESCRIPTION = "description"
    STORY = "story"
    AD_COPY = "ad_copy"
    SCRIPT = "script"

class Platform(Enum):
    INSTAGRAM = "instagram"
    TIKTOK = "tiktok"
    TWITTER = "twitter"
    FACEBOOK = "facebook"
    YOUTUBE = "youtube"
    LINKEDIN = "linkedin"
    PINTEREST = "pinterest"
    SNAPCHAT = "snapchat"

class AIProvider(Enum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    FALLBACK = "fallback"

@dataclass
class ContentRequest:
    user_id: str
    content_type: ContentType
    platform: Platform
    prompt: str
    language: str = "en"
    tone: str = "professional"
    length: str = "medium"
    target_audience: str = "general"
    keywords: List[str] = None
    brand_voice: str = "neutral"
    
    def __post_init__(self):
        if self.keywords is None:
            self.keywords = []

@dataclass
class GeneratedContent:
    content: str
    variations: List[str]
    hashtags: List[str]
    metrics_prediction: Dict[str, float]
    platform_optimized: bool
    generation_time: float
    ai_provider: AIProvider
    cached: bool = False

class AIService:
    def __init__(self):
        self.redis_client = None
        self.openai_client = None
        self.anthropic_client = None
        self.encryption_key = Fernet.generate_key()
        self.cipher_suite = Fernet(self.encryption_key)
        self.offline_cache = {}
        self.user_preferences = {}
        self.content_templates = self._load_content_templates()
        self.platform_specs = self._load_platform_specifications()
        
    async def initialize(self):
        """Initialize AI service with connections and cache"""
        try:
            # Initialize Redis for caching
            self.redis_client = aioredis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5,
                retry_on_timeout=True,
                max_connections=20
            )
            
            # Initialize AI clients with proper error handling
            if settings.OPENAI_API_KEY:
                openai.api_key = settings.OPENAI_API_KEY
                self.openai_client = openai.AsyncOpenAI(
                    api_key=settings.OPENAI_API_KEY,
                    timeout=30.0,
                    max_retries=3
                )
            
            if settings.ANTHROPIC_API_KEY:
                self.anthropic_client = AsyncAnthropic(
                    api_key=settings.ANTHROPIC_API_KEY,
                    timeout=30.0,
                    max_retries=3
                )
            
            # Preload user preferences and offline content
            await self._preload_user_data()
            
            logger.info("AI Service initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize AI Service: {e}")
            # Initialize offline-only mode
            await self._initialize_offline_mode()
    
    @rate_limiter(max_calls=100, window=3600)  # 100 calls per hour per user
    async def generate_content(
        self, 
        request: ContentRequest, 
        user_subscription: str = "freemium"
    ) -> GeneratedContent:
        """Generate AI content with smart caching and offline fallback"""
        start_time = time.time()
        
        try:
            # Validate subscription limits
            if not await self._validate_subscription_limits(request.user_id, user_subscription):
                raise ValueError("Subscription limit exceeded")
            
            # Check cache first
            cached_content = await self._get_cached_content(request)
            if cached_content:
                logger.info(f"Content served from cache for user {request.user_id}")
                return cached_content
            
            # Generate new content
            content = await self._generate_new_content(request, user_subscription)
            
            # Cache the result
            await self._cache_content(request, content)
            
            # Log activity for analytics
            await log_user_activity(
                request.user_id, 
                "content_generated", 
                {"type": request.content_type.value, "platform": request.platform.value}
            )
            
            content.generation_time = time.time() - start_time
            return content
            
        except Exception as e:
            logger.error(f"Content generation failed: {e}")
            # Fallback to offline content
            return await self._generate_offline_content(request)
    
    async def _generate_new_content(
        self, 
        request: ContentRequest, 
        subscription: str
    ) -> GeneratedContent:
        """Generate new content using AI providers with intelligent fallback"""
        
        # Determine best AI provider based on content type and subscription
        provider = await self._select_ai_provider(request, subscription)
        
        try:
            if provider == AIProvider.OPENAI and self.openai_client:
                return await self._generate_with_openai(request, subscription)
            elif provider == AIProvider.ANTHROPIC and self.anthropic_client:
                return await self._generate_with_anthropic(request, subscription)
            else:
                return await self._generate_with_fallback(request)
                
        except Exception as e:
            logger.warning(f"Primary AI provider failed: {e}")
            # Try alternative provider
            if provider != AIProvider.FALLBACK:
                return await self._generate_with_fallback(request)
            raise
    
    async def _generate_with_openai(
        self, 
        request: ContentRequest, 
        subscription: str
    ) -> GeneratedContent:
        """Generate content using OpenAI with advanced prompting"""
        
        # Build sophisticated prompt
        system_prompt = await self._build_system_prompt(request, subscription)
        user_prompt = await self._build_user_prompt(request)
        
        # Determine model based on subscription
        model = self._get_openai_model(subscription)
        
        try:
            response = await self.openai_client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.7,
                max_tokens=self._get_max_tokens(request.content_type, subscription),
                top_p=0.9,
                frequency_penalty=0.1,
                presence_penalty=0.1
            )
            
            content_data = json.loads(response.choices[0].message.content)
            
            return GeneratedContent(
                content=content_data.get("main_content", ""),
                variations=content_data.get("variations", []),
                hashtags=content_data.get("hashtags", []),
                metrics_prediction=content_data.get("metrics", {}),
                platform_optimized=True,
                generation_time=0.0,
                ai_provider=AIProvider.OPENAI
            )
            
        except Exception as e:
            logger.error(f"OpenAI generation failed: {e}")
            raise
    
    async def _generate_with_anthropic(
        self, 
        request: ContentRequest, 
        subscription: str
    ) -> GeneratedContent:
        """Generate content using Anthropic Claude with advanced reasoning"""
        
        prompt = await self._build_anthropic_prompt(request, subscription)
        model = self._get_anthropic_model(subscription)
        
        try:
            response = await self.anthropic_client.messages.create(
                model=model,
                max_tokens=self._get_max_tokens(request.content_type, subscription),
                temperature=0.7,
                messages=[{"role": "user", "content": prompt}]
            )
            
            content_data = json.loads(response.content[0].text)
            
            return GeneratedContent(
                content=content_data.get("main_content", ""),
                variations=content_data.get("variations", []),
                hashtags=content_data.get("hashtags", []),
                metrics_prediction=content_data.get("metrics", {}),
                platform_optimized=True,
                generation_time=0.0,
                ai_provider=AIProvider.ANTHROPIC
            )
            
        except Exception as e:
            logger.error(f"Anthropic generation failed: {e}")
            raise
    
    async def _generate_with_fallback(self, request: ContentRequest) -> GeneratedContent:
        """Generate content using local templates and smart algorithms"""
        
        # Use template-based generation for offline capability
        template = self._get_content_template(request.content_type, request.platform)
        
        # Apply intelligent text processing
        content = await self._process_template(template, request)
        variations = await self._generate_variations(content, request)
        hashtags = await self._generate_hashtags(request)
        
        # Predict metrics based on historical data
        metrics = await self._predict_engagement_metrics(request)
        
        return GeneratedContent(
            content=content,
            variations=variations,
            hashtags=hashtags,
            metrics_prediction=metrics,
            platform_optimized=True,
            generation_time=0.0,
            ai_provider=AIProvider.FALLBACK
        )
    
    async def _generate_offline_content(self, request: ContentRequest) -> GeneratedContent:
        """Generate content entirely offline using cached templates and user data"""
        
        # Check if user has offline content preferences
        user_prefs = self.user_preferences.get(request.user_id, {})
        
        # Use offline template system
        template_key = f"{request.content_type.value}_{request.platform.value}_{request.language}"
        template = self.offline_cache.get(template_key)
        
        if not template:
            template = self._get_default_template(request.content_type, request.platform)
        
        # Generate content using offline algorithms
        content = self._fill_template(template, request, user_prefs)
        variations = self._create_offline_variations(content, request)
        hashtags = self._generate_offline_hashtags(request)
        
        return GeneratedContent(
            content=content,
            variations=variations,
            hashtags=hashtags,
            metrics_prediction={"engagement": 0.65, "reach": 0.70, "clicks": 0.45},
            platform_optimized=True,
            generation_time=0.1,
            ai_provider=AIProvider.FALLBACK,
            cached=True
        )
    
    async def _build_system_prompt(self, request: ContentRequest, subscription: str) -> str:
        """Build sophisticated system prompt for AI generation"""
        
        platform_spec = self.platform_specs.get(request.platform.value, {})
        user_history = await self._get_user_content_history(request.user_id)
        
        return f"""
        You are an expert social media content creator and digital marketing strategist.
        
        CONTEXT:
        - Platform: {request.platform.value.title()}
        - Content Type: {request.content_type.value.title()}
        - Language: {request.language}
        - Target Audience: {request.target_audience}
        - Brand Voice: {request.brand_voice}
        - Subscription Level: {subscription}
        
        PLATFORM SPECIFICATIONS:
        - Character Limit: {platform_spec.get('char_limit', 'flexible')}
        - Optimal Length: {platform_spec.get('optimal_length', 'medium')}
        - Hashtag Limit: {platform_spec.get('hashtag_limit', 30)}
        - Best Posting Times: {platform_spec.get('best_times', 'varies')}
        
        USER PERFORMANCE HISTORY:
        {self._summarize_user_history(user_history)}
        
        REQUIREMENTS:
        1. Create highly engaging, platform-optimized content
        2. Include cultural sensitivity and local relevance
        3. Provide multiple variations for A/B testing
        4. Generate relevant hashtags with trending analysis
        5. Predict engagement metrics based on content analysis
        6. Ensure brand voice consistency
        7. Include call-to-action optimization
        
        OUTPUT FORMAT (JSON):
        {{
            "main_content": "Primary content text",
            "variations": ["variation1", "variation2", "variation3"],
            "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3"],
            "metrics": {{
                "engagement_prediction": 0.75,
                "reach_prediction": 0.80,
                "click_prediction": 0.45,
                "viral_potential": 0.35
            }},
            "optimization_tips": ["tip1", "tip2"],
            "best_post_time": "2024-01-15T14:30:00Z"
        }}
        """
    
    async def _build_user_prompt(self, request: ContentRequest) -> str:
        """Build user-specific prompt with context and preferences"""
        
        keywords_str = ", ".join(request.keywords) if request.keywords else "none specified"
        
        return f"""
        Create {request.content_type.value} for {request.platform.value} with these specifications:
        
        PROMPT: {request.prompt}
        
        DETAILS:
        - Tone: {request.tone}
        - Length: {request.length}
        - Keywords to include: {keywords_str}
        - Language: {request.language}
        
        SPECIAL REQUIREMENTS:
        - Make it highly engaging and shareable
        - Include trending elements relevant to current date
        - Optimize for {request.platform.value} algorithm
        - Consider cultural nuances for {request.language} speakers
        - Include subtle psychological triggers for engagement
        
        Generate the content following the JSON format specified in the system prompt.
        """
    
    async def _get_cached_content(self, request: ContentRequest) -> Optional[GeneratedContent]:
        """Retrieve cached content with intelligent cache key generation"""
        
        cache_key = self._generate_cache_key(request)
        
        try:
            if self.redis_client:
                cached_data = await self.redis_client.get(cache_key)
                if cached_data:
                    data = json.loads(cached_data)
                    content = GeneratedContent(**data)
                    content.cached = True
                    return content
            
            # Check offline cache
            if cache_key in self.offline_cache:
                data = self.offline_cache[cache_key]
                content = GeneratedContent(**data)
                content.cached = True
                return content
                
        except Exception as e:
            logger.warning(f"Cache retrieval failed: {e}")
        
        return None
    
    async def _cache_content(self, request: ContentRequest, content: GeneratedContent):
        """Cache generated content with intelligent expiration"""
        
        cache_key = self._generate_cache_key(request)
        cache_data = asdict(content)
        cache_data['cached_at'] = datetime.utcnow().isoformat()
        
        # Determine cache duration based on content type and subscription
        cache_duration = self._get_cache_duration(request.content_type, request.user_id)
        
        try:
            if self.redis_client:
                await self.redis_client.setex(
                    cache_key, 
                    cache_duration, 
                    json.dumps(cache_data, default=str)
                )
            
            # Also cache offline for immediate access
            self.offline_cache[cache_key] = cache_data
            
            # Limit offline cache size
            if len(self.offline_cache) > 1000:
                self._cleanup_offline_cache()
                
        except Exception as e:
            logger.warning(f"Caching failed: {e}")
    
    def _generate_cache_key(self, request: ContentRequest) -> str:
        """Generate intelligent cache key considering all relevant factors"""
        
        # Create hash from request parameters
        cache_data = {
            'content_type': request.content_type.value,
            'platform': request.platform.value,
            'prompt_hash': hashlib.md5(request.prompt.encode()).hexdigest()[:16],
            'language': request.language,
            'tone': request.tone,
            'length': request.length,
            'keywords': sorted(request.keywords) if request.keywords else [],
            'brand_voice': request.brand_voice
        }
        
        cache_string = json.dumps(cache_data, sort_keys=True)
        cache_hash = hashlib.sha256(cache_string.encode()).hexdigest()[:32]
        
        return f"content:{request.user_id}:{cache_hash}"
    
    def _load_content_templates(self) -> Dict[str, Any]:
        """Load content templates for offline generation"""
        
        return {
            "instagram_caption": {
                "templates": [
                    "🌟 {prompt} ✨\n\n{call_to_action}\n\n{hashtags}",
                    "Ready to {prompt}? 💪\n\n{description}\n\n{hashtags}",
                    "{hook} 🔥\n\n{prompt}\n\n{call_to_action}\n\n{hashtags}"
                ],
                "hooks": ["Did you know", "Here's the secret", "This changed everything"],
                "ctas": ["Double tap if you agree!", "Save this for later!", "Tag a friend!"]
            },
            "tiktok_script": {
                "templates": [
                    "Hook: {hook}\nProblem: {problem}\nSolution: {solution}\nCTA: {cta}",
                    "Trend: {trend}\nYour take: {prompt}\nPunchline: {punchline}"
                ]
            },
            "twitter_tweet": {
                "templates": [
                    "{prompt}\n\nThoughts? 🤔",
                    "Hot take: {prompt}\n\n{hashtags}",
                    "Today I learned: {prompt}\n\nWhat's your experience?"
                ]
            }
        }
    
    def _load_platform_specifications(self) -> Dict[str, Dict]:
        """Load platform-specific requirements and optimization rules"""
        
        return {
            "instagram": {
                "char_limit": 2200,
                "optimal_length": "125-150 chars",
                "hashtag_limit": 30,
                "best_times": ["11am-1pm", "7pm-9pm"],
                "algorithm_factors": ["engagement_rate", "saves", "shares", "comments"]
            },
            "tiktok": {
                "char_limit": 4000,
                "optimal_length": "100-150 chars",
                "hashtag_limit": 100,
                "best_times": ["6am-10am", "7pm-9pm"],
                "algorithm_factors": ["completion_rate", "shares", "comments", "likes"]
            },
            "twitter": {
                "char_limit": 280,
                "optimal_length": "71-100 chars",
                "hashtag_limit": 2,
                "best_times": ["9am-10am", "8pm-9pm"],
                "algorithm_factors": ["retweets", "replies", "likes", "click_rate"]
            },
            "linkedin": {
                "char_limit": 3000,
                "optimal_length": "150-300 chars",
                "hashtag_limit": 5,
                "best_times": ["8am-9am", "12pm-1pm", "5pm-6pm"],
                "algorithm_factors": ["comments", "shares", "click_rate", "dwell_time"]
            }
        }
    
    async def _validate_subscription_limits(self, user_id: str, subscription: str) -> bool:
        """Validate user subscription limits with smart quota management"""
        
        # Get user's current usage
        today = datetime.utcnow().date()
        
        # Define limits by subscription tier
        limits = {
            "freemium": {"daily": 10, "monthly": 100},
            "premium": {"daily": 100, "monthly": 2000},
            "enterprise": {"daily": 1000, "monthly": 20000}
        }
        
        try:
            async with get_db() as db:
                # Check daily usage
                daily_count = await db.execute(
                    select(ContentGeneration).where(
                        ContentGeneration.user_id == user_id,
                        ContentGeneration.created_at >= today
                    )
                )
                daily_usage = len(daily_count.fetchall())
                
                subscription_limits = limits.get(subscription, limits["freemium"])
                
                if daily_usage >= subscription_limits["daily"]:
                    logger.warning(f"Daily limit exceeded for user {user_id}")
                    return False
                
                return True
                
        except Exception as e:
            logger.error(f"Limit validation failed: {e}")
            # Allow on error to prevent service disruption
            return True
    
    async def generate_bulk_content(
        self, 
        requests: List[ContentRequest], 
        user_subscription: str = "freemium"
    ) -> List[GeneratedContent]:
        """Generate multiple content pieces efficiently with batch processing"""
        
        # Validate bulk limits
        bulk_limits = {"freemium": 5, "premium": 25, "enterprise": 100}
        max_batch = bulk_limits.get(user_subscription, 5)
        
        if len(requests) > max_batch:
            raise ValueError(f"Batch size exceeds limit for {user_subscription} subscription")
        
        # Process in parallel with concurrency limits
        semaphore = asyncio.Semaphore(5)  # Limit concurrent API calls
        
        async def generate_single(request):
            async with semaphore:
                return await self.generate_content(request, user_subscription)
        
        try:
            results = await asyncio.gather(
                *[generate_single(req) for req in requests],
                return_exceptions=True
            )
            
            # Handle any exceptions
            successful_results = []
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    logger.error(f"Bulk generation failed for request {i}: {result}")
                    # Provide fallback content
                    fallback = await self._generate_offline_content(requests[i])
                    successful_results.append(fallback)
                else:
                    successful_results.append(result)
            
            return successful_results
            
        except Exception as e:
            logger.error(f"Bulk content generation failed: {e}")
            # Return offline alternatives for all requests
            return [await self._generate_offline_content(req) for req in requests]
    
    async def get_content_analytics(self, user_id: str, days: int = 30) -> Dict[str, Any]:
        """Get comprehensive content performance analytics"""
        
        try:
            async with get_db() as db:
                # Get content performance data
                end_date = datetime.utcnow()
                start_date = end_date - timedelta(days=days)
                
                content_data = await db.execute(
                    select(ContentGeneration).where(
                        ContentGeneration.user_id == user_id,
                        ContentGeneration.created_at >= start_date
                    )
                )
                
                contents = content_data.fetchall()
                
                # Analyze performance
                analytics = {
                    "total_generated": len(contents),
                    "by_platform": {},
                    "by_content_type": {},
                    "performance_metrics": {},
                    "recommendations": [],
                    "trending_topics": [],
                    "optimal_times": {},
                    "engagement_predictions": {}
                }
                
                # Process analytics data
                for content in contents:
                    platform = content.platform
                    content_type = content.content_type
                    
                    # Count by platform
                    analytics["by_platform"][platform] = analytics["by_platform"].get(platform, 0) + 1
                    
                    # Count by content type
                    analytics["by_content_type"][content_type] = analytics["by_content_type"].get(content_type, 0) + 1
                
                # Add AI-driven recommendations
                analytics["recommendations"] = await self._generate_content_recommendations(user_id, contents)
                
                return analytics
                
        except Exception as e:
            logger.error(f"Analytics generation failed: {e}")
            return {"error": "Analytics temporarily unavailable"}
    
    async def _generate_content_recommendations(self, user_id: str, contents: List) -> List[str]:
        """Generate AI-driven content recommendations based on user history"""
        
        recommendations = []
        
        # Analyze user patterns
        if contents:
            # Most used platforms
            platform_counts = {}
            for content in contents:
                platform = content.platform
                platform_counts[platform] = platform_counts.get(platform, 0) + 1
            
            top_platform = max(platform_counts, key=platform_counts.get)
            
            recommendations.extend([
                f"Your top-performing platform is {top_platform}. Consider increasing content frequency here.",
                "Try cross-posting your best content to other platforms for maximum reach.",
                "Experiment with video content - it's showing 3x higher engagement rates.",
                "Consider posting during peak hours: 7-9 PM for maximum visibility."
            ])
        else:
            recommendations.extend([
                "Start with Instagram posts - they're easiest to create and have broad appeal.",
                "Focus on educational content - it performs well across all platforms.",
                "Use trending hashtags to increase discoverability.",
                "Create content series to build audience anticipation."
            ])
        
        return recommendations[:5]  # Return top 5 recommendations
    
    async def _preload_user_data(self):
        """Preload user preferences and frequently used content for offline access"""
        
        try:
            async with get_db() as db:
                # Load user preferences
                users = await db.execute(select(User))
                for user in users.fetchall():
                    self.user_preferences[user.id] = {
                        "language": getattr(user, 'preferred_language', 'en'),
                        "brand_voice": getattr(user, 'brand_voice', 'professional'),
                        "target_audience": getattr(user, 'target_audience', 'general'),
                        "common_keywords": getattr(user, 'common_keywords', [])
                    }
                
                # Preload popular content templates
                await self._cache_popular_templates()
                
                logger.info(f"Preloaded data for {len(self.user_preferences)} users")
                
        except Exception as e:
            logger.warning(f"Failed to preload user data: {e}")
    
    async def _cache_popular_templates(self):
        """Cache popular content templates for offline use"""
        
        popular_templates = {
            f"template_{platform}_{content_type}": template
            for platform in Platform
            for content_type in ContentType
            for template in self.content_templates.get(f"{platform.value}_{content_type.value}", {}).get("templates", [])
        }
        
        self.offline_cache.update(popular_templates)
    
    async def _initialize_offline_mode(self):
        """Initialize service for offline-only operation"""
        
        logger.warning("Initializing AI Service in offline mode")
        
        # Load enhanced offline templates
        self.offline_cache.update({
            "fallback_content": {
                "captions": [
                    "Transform your {topic} with these simple steps! ✨",
                    "Here's what nobody tells you about {topic} 🤫",
                    "The secret to mastering {topic} is simpler than you think 💡"
                ],
                "hashtags": [
                    "#trending", "#viral", "#motivation", "#success", "#tips",
                    "#lifestyle", "#business", "#growth", "#inspiration", "#goals"
                ]
            }
        })
        
        logger.info("Offline mode initialized successfully")
    
    def _cleanup_offline_cache(self):
        """Clean up offline cache to prevent memory issues"""
        
        # Remove oldest entries (simple LRU implementation)
        sorted_items = sorted(
            self.offline_cache.items(),
            key=lambda x: x[1].get('cached_at', '1970-01-01') if isinstance(x[1], dict) else '1970-01-01'
        )
        
        # Keep most recent 500 items
        self.offline_cache = dict(sorted_items[-500:])
        
        logger.info("Offline cache cleaned up")
    
    async def __aenter__(self):
        await self.initialize()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.redis_client:
            await self.redis_client.close()
        logger.info("AI Service shutdown complete")

# Singleton instance
ai_service = AIService()

# Utility functions for external use
async def generate_content_for_user(
    user_id: str,
    prompt: str,
    content_type: str,
    platform: str,
    **kwargs
) -> Dict[str, Any]:
    """Convenient function for generating content from external modules"""
    
    request = ContentRequest(
        user_id=user_id,
        content_type=ContentType(content_type),
        platform=Platform(platform),
        prompt=prompt,
        **kwargs
    )
    
    # Get user subscription
    async with get_db() as db:
        user_sub = await db.execute(
            select(UserSubscription).where(UserSubscription.user_id == user_id)
        )
        subscription = user_sub.scalar()
        tier = subscription.tier if subscription else "freemium"
    
    result = await ai_service.generate_content(request, tier)
    return asdict(result)

async def get_user_analytics(user_id: str, days: int = 30) -> Dict[str, Any]:
    """Get analytics for a specific user"""
    return await ai_service.get_content_analytics(user_id, days)