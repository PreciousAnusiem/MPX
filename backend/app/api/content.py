"""
ONXLink AI Content Generation API
Handles content generation, optimization, and management
"""

from typing import List, Dict, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from fastapi.security import HTTPBearer
from pydantic import BaseModel, Field, validator
from datetime import datetime, timedelta
import json
import hashlib
import asyncio
import aiohttp
import re
from enum import Enum
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, desc, asc
import logging
from cachetools import TTLCache
import random
from collections import defaultdict
import uuid

from ..database import get_db
from ..models import User, GeneratedContent, ContentTemplate, TrendingTopic, UserSubscription
from ..auth import get_current_user, verify_subscription_tier
from ..config import settings
from ..utils import sanitize_content, detect_language, validate_content_safety, encrypt_sensitive_data

# Initialize router
router = APIRouter(prefix="/api/content", tags=["Content Generation"])
security = HTTPBearer()

# Initialize logging
logger = logging.getLogger(__name__)

# Content cache for offline capabilities
content_cache = TTLCache(maxsize=1000, ttl=3600)  # 1 hour cache
template_cache = TTLCache(maxsize=500, ttl=7200)   # 2 hour cache

class ContentType(str, Enum):
    CAPTION = "caption"
    HASHTAGS = "hashtags"
    STORY = "story"
    REEL_SCRIPT = "reel_script"
    THREAD = "thread"
    BLOG_POST = "blog_post"
    PRODUCT_DESC = "product_desc"
    AD_COPY = "ad_copy"

class PlatformType(str, Enum):
    INSTAGRAM = "instagram"
    TIKTOK = "tiktok"
    TWITTER = "twitter"
    FACEBOOK = "facebook"
    LINKEDIN = "linkedin"
    YOUTUBE = "youtube"
    PINTEREST = "pinterest"
    SNAPCHAT = "snapchat"
    AMAZON_LIVE = "amazon_live"
    SHOPIFY = "shopify"

class ToneType(str, Enum):
    PROFESSIONAL = "professional"
    CASUAL = "casual"
    HUMOROUS = "humorous"
    INSPIRING = "inspiring"
    URGENT = "urgent"
    FRIENDLY = "friendly"
    AUTHORITATIVE = "authoritative"
    CONVERSATIONAL = "conversational"

# Request Models
class ContentGenerationRequest(BaseModel):
    prompt: str = Field(..., min_length=10, max_length=1000)
    content_type: ContentType
    platforms: List[PlatformType] = Field(..., min_items=1, max_items=50)
    tone: ToneType = ToneType.CONVERSATIONAL
    target_audience: Optional[str] = Field(None, max_length=200)
    language: str = Field("en", regex="^[a-z]{2}$")
    include_hashtags: bool = True
    include_emojis: bool = True
    character_limit: Optional[int] = Field(None, ge=50, le=10000)
    keywords: Optional[List[str]] = Field(None, max_items=20)
    brand_voice: Optional[str] = Field(None, max_length=500)
    call_to_action: Optional[str] = Field(None, max_length=100)
    variations_count: int = Field(3, ge=1, le=100)

    @validator('platforms')
    def validate_platforms(cls, v):
        if len(set(v)) != len(v):
            raise ValueError('Duplicate platforms not allowed')
        return v

    @validator('keywords')
    def validate_keywords(cls, v):
        if v:
            for keyword in v:
                if len(keyword.strip()) < 2:
                    raise ValueError('Keywords must be at least 2 characters')
        return v

class BulkContentRequest(BaseModel):
    prompts: List[str] = Field(..., min_items=1, max_items=50)
    content_type: ContentType
    platforms: List[PlatformType] = Field(..., min_items=1, max_items=50)
    tone: ToneType = ToneType.CONVERSATIONAL
    language: str = Field("en", regex="^[a-z]{2}$")
    variations_per_prompt: int = Field(3, ge=1, le=10)

class ContentOptimizationRequest(BaseModel):
    content_id: str
    target_platform: PlatformType
    optimization_type: str = Field(..., regex="^(engagement|reach|conversion|brand_awareness)$")

class ContentTemplateRequest(BaseModel):
    name: str = Field(..., min_length=3, max_length=100)
    template: str = Field(..., min_length=10, max_length=2000)
    content_type: ContentType
    variables: Optional[Dict[str, str]] = Field(None, max_items=20)
    is_public: bool = False

# Response Models
class GeneratedContentItem(BaseModel):
    id: str
    content: str
    platform: PlatformType
    character_count: int
    hashtags: List[str]
    engagement_score: float
    readability_score: float
    sentiment_score: float
    language: str
    created_at: datetime

class ContentGenerationResponse(BaseModel):
    request_id: str
    total_variations: int
    generated_content: List[GeneratedContentItem]
    processing_time: float
    credits_used: int
    remaining_credits: int
    optimization_suggestions: List[str]

class ContentAnalyticsResponse(BaseModel):
    content_id: str
    performance_metrics: Dict[str, Any]
    recommendations: List[str]
    trending_elements: List[str]
    competitor_analysis: Dict[str, Any]

# Offline Content Templates
OFFLINE_TEMPLATES = {
    "caption": {
        "business": [
            "{hook} {main_content} {call_to_action} {hashtags}",
            "💡 {insight} {main_content} What's your take? {hashtags}",
            "{question} {main_content} Drop a comment below! {hashtags}"
        ],
        "lifestyle": [
            "{emoji} {personal_story} {main_content} {hashtags}",
            "Here's why {topic} changed everything: {main_content} {hashtags}",
            "Real talk: {main_content} Who else relates? {hashtags}"
        ]
    },
    "hashtags": {
        "trending": ["#trending", "#viral", "#fyp", "#explore", "#instagood"],
        "business": ["#entrepreneur", "#business", "#success", "#marketing", "#growth"],
        "lifestyle": ["#lifestyle", "#inspiration", "#motivation", "#mindset", "#wellness"]
    }
}

# AI Service Integration
class AIContentGenerator:
    def __init__(self):
        self.api_keys = {
            'openai': settings.OPENAI_API_KEY,
            'claude': settings.ANTHROPIC_API_KEY,
            'gemini': settings.GOOGLE_API_KEY
        }
        self.session = None
        
    async def get_session(self):
        if not self.session:
            self.session = aiohttp.ClientSession()
        return self.session
    
    async def generate_with_openai(self, prompt: str, parameters: dict) -> Dict[str, Any]:
        """Generate content using OpenAI GPT"""
        session = await self.get_session()
        
        headers = {
            'Authorization': f'Bearer {self.api_keys["openai"]}',
            'Content-Type': 'application/json'
        }
        
        data = {
            'model': 'gpt-4',
            'messages': [
                {
                    'role': 'system',
                    'content': self._build_system_prompt(parameters)
                },
                {
                    'role': 'user',
                    'content': prompt
                }
            ],
            'max_tokens': parameters.get('max_tokens', 1000),
            'temperature': parameters.get('temperature', 0.8),
            'presence_penalty': 0.6,
            'frequency_penalty': 0.3
        }
        
        try:
            async with session.post(
                'https://api.openai.com/v1/chat/completions',
                headers=headers,
                json=data,
                timeout=30
            ) as response:
                if response.status == 200:
                    result = await response.json()
                    return {
                        'content': result['choices'][0]['message']['content'],
                        'tokens_used': result['usage']['total_tokens'],
                        'model': 'gpt-4'
                    }
                else:
                    logger.error(f"OpenAI API error: {response.status}")
                    return None
        except Exception as e:
            logger.error(f"OpenAI generation error: {str(e)}")
            return None
    
    async def generate_with_claude(self, prompt: str, parameters: dict) -> Dict[str, Any]:
        """Generate content using Anthropic Claude"""
        session = await self.get_session()
        
        headers = {
            'x-api-key': self.api_keys["claude"],
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01'
        }
        
        data = {
            'model': 'claude-3-sonnet-20240229',
            'max_tokens': parameters.get('max_tokens', 1000),
            'messages': [
                {
                    'role': 'user',
                    'content': f"{self._build_system_prompt(parameters)}\n\n{prompt}"
                }
            ],
            'temperature': parameters.get('temperature', 0.8)
        }
        
        try:
            async with session.post(
                'https://api.anthropic.com/v1/messages',
                headers=headers,
                json=data,
                timeout=30
            ) as response:
                if response.status == 200:
                    result = await response.json()
                    return {
                        'content': result['content'][0]['text'],
                        'tokens_used': result['usage']['input_tokens'] + result['usage']['output_tokens'],
                        'model': 'claude-3-sonnet'
                    }
                else:
                    logger.error(f"Claude API error: {response.status}")
                    return None
        except Exception as e:
            logger.error(f"Claude generation error: {str(e)}")
            return None
    
    def _build_system_prompt(self, parameters: dict) -> str:
        """Build system prompt based on parameters"""
        platform_specs = self._get_platform_specifications(parameters.get('platforms', []))
        
        return f"""
        You are an expert social media content creator and marketing strategist.
        
        CONTENT REQUIREMENTS:
        - Content Type: {parameters.get('content_type', 'caption')}
        - Tone: {parameters.get('tone', 'conversational')}
        - Language: {parameters.get('language', 'en')}
        - Target Audience: {parameters.get('target_audience', 'general audience')}
        
        PLATFORM SPECIFICATIONS:
        {platform_specs}
        
        BRAND VOICE:
        {parameters.get('brand_voice', 'Authentic, engaging, and value-driven')}
        
        CONTENT GUIDELINES:
        1. Create engaging, authentic content that resonates with the target audience
        2. Include relevant hashtags and emojis when appropriate
        3. Ensure content is optimized for each specified platform
        4. Maintain brand consistency across all variations
        5. Include clear call-to-action when specified
        6. Avoid controversial, offensive, or inappropriate content
        7. Ensure content is culturally sensitive and inclusive
        
        Generate multiple high-quality variations that are platform-optimized and engaging.
        """
    
    def _get_platform_specifications(self, platforms: List[str]) -> str:
        """Get platform-specific requirements"""
        specs = {
            'instagram': 'Instagram: 2200 char limit, use hashtags, visual-focused',
            'tiktok': 'TikTok: 2200 char limit, trending hashtags, video-focused',
            'twitter': 'Twitter: 280 char limit, concise, trending topics',
            'facebook': 'Facebook: 63206 char limit, engaging, community-focused',
            'linkedin': 'LinkedIn: 3000 char limit, professional tone, business-focused',
            'youtube': 'YouTube: 5000 char limit, descriptive, SEO-optimized',
            'pinterest': 'Pinterest: 500 char limit, visual keywords, inspirational',
            'snapchat': 'Snapchat: 250 char limit, casual, youth-focused'
        }
        
        return '\n'.join([specs.get(p, f'{p}: Standard social media format') for p in platforms])
    
    async def generate_offline_content(self, request: ContentGenerationRequest) -> List[Dict[str, Any]]:
        """Generate content using offline templates when API is unavailable"""
        content_variations = []
        
        template_type = "business" if "business" in request.prompt.lower() else "lifestyle"
        templates = OFFLINE_TEMPLATES.get(request.content_type.value, {}).get(template_type, [])
        
        if not templates:
            # Fallback generic templates
            templates = [
                "{main_content} {hashtags}",
                "💡 {main_content} What do you think? {hashtags}",
                "{main_content} Share your thoughts below! {hashtags}"
            ]
        
        hashtags = self._generate_offline_hashtags(request.prompt, request.content_type.value)
        
        for i, template in enumerate(templates[:request.variations_count]):
            content = template.format(
                hook=self._generate_hook(request.prompt),
                main_content=request.prompt,
                call_to_action=request.call_to_action or "What's your take?",
                hashtags=" ".join(hashtags[:10]),
                emoji=random.choice(["💫", "✨", "🚀", "💡", "🎯"]),
                question=self._generate_question(request.prompt),
                personal_story="Here's my experience:",
                insight=f"Key insight:",
                topic=request.prompt.split()[0] if request.prompt.split() else "this"
            )
            
            content_variations.append({
                'id': str(uuid.uuid4()),
                'content': content[:request.character_limit] if request.character_limit else content,
                'hashtags': hashtags,
                'engagement_score': random.uniform(0.6, 0.9),
                'readability_score': random.uniform(0.7, 0.95),
                'sentiment_score': random.uniform(0.5, 0.9),
                'source': 'offline_template'
            })
        
        return content_variations
    
    def _generate_offline_hashtags(self, prompt: str, content_type: str) -> List[str]:
        """Generate hashtags based on prompt analysis"""
        words = re.findall(r'\w+', prompt.lower())
        
        # Base hashtags from templates
        base_hashtags = OFFLINE_TEMPLATES.get("hashtags", {}).get("trending", [])
        
        # Generate hashtags from prompt words
        generated_hashtags = [f"#{word}" for word in words if len(word) > 3][:5]
        
        # Combine and deduplicate
        all_hashtags = list(set(base_hashtags + generated_hashtags))
        
        return all_hashtags[:15]
    
    def _generate_hook(self, prompt: str) -> str:
        """Generate engaging hooks"""
        hooks = [
            "Here's what I learned:",
            "This changed everything:",
            "You need to know this:",
            "Real talk:",
            "Here's the truth:"
        ]
        return random.choice(hooks)
    
    def _generate_question(self, prompt: str) -> str:
        """Generate engaging questions"""
        questions = [
            "What's your experience with this?",
            "Have you tried this approach?",
            "What would you do differently?",
            "How do you handle this situation?",
            "What's worked best for you?"
        ]
        return random.choice(questions)

# Initialize AI generator
ai_generator = AIContentGenerator()

# Content Analysis Functions
def analyze_content_performance(content: str, platform: str) -> Dict[str, float]:
    """Analyze content performance metrics"""
    
    # Engagement score based on content characteristics
    engagement_factors = {
        'has_question': '?' in content,
        'has_emoji': bool(re.search(r'[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF]', content)),
        'has_hashtags': '#' in content,
        'has_call_to_action': any(cta in content.lower() for cta in ['comment', 'share', 'like', 'follow', 'click', 'visit']),
        'optimal_length': _is_optimal_length(content, platform)
    }
    
    engagement_score = sum(engagement_factors.values()) / len(engagement_factors)
    
    # Readability score (simplified Flesch-Kincaid)
    sentences = len(re.split(r'[.!?]+', content))
    words = len(content.split())
    readability_score = max(0.1, min(1.0, 1 - (words / max(sentences, 1)) / 20))
    
    # Sentiment analysis (simplified)
    positive_words = ['amazing', 'great', 'awesome', 'love', 'best', 'excellent']
    negative_words = ['hate', 'worst', 'terrible', 'awful', 'bad']
    
    positive_count = sum(1 for word in positive_words if word in content.lower())
    negative_count = sum(1 for word in negative_words if word in content.lower())
    
    sentiment_score = 0.5 + (positive_count - negative_count) * 0.1
    sentiment_score = max(0.0, min(1.0, sentiment_score))
    
    return {
        'engagement_score': engagement_score,
        'readability_score': readability_score,
        'sentiment_score': sentiment_score
    }

def _is_optimal_length(content: str, platform: str) -> bool:
    """Check if content length is optimal for platform"""
    length = len(content)
    optimal_ranges = {
        'instagram': (125, 2200),
        'twitter': (71, 280),
        'facebook': (40, 80),
        'linkedin': (150, 300),
        'tiktok': (100, 2200),
        'youtube': (200, 1000)
    }
    
    min_len, max_len = optimal_ranges.get(platform, (50, 500))
    return min_len <= length <= max_len

def extract_hashtags(content: str) -> List[str]:
    """Extract hashtags from content"""
    return re.findall(r'#\w+', content)

def calculate_character_count(content: str) -> int:
    """Calculate character count excluding certain elements"""
    # Remove URLs for character count
    content_no_urls = re.sub(r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+', '', content)
    return len(content_no_urls.strip())

# API Endpoints

@router.post("/generate", response_model=ContentGenerationResponse)
async def generate_content(
    request: ContentGenerationRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Generate AI-powered content for multiple platforms"""
    
    start_time = datetime.now()
    request_id = str(uuid.uuid4())
    
    try:
        # Verify subscription tier and limits
        subscription = verify_subscription_tier(current_user, db)
        
        # Check generation limits
        daily_limit = _get_daily_generation_limit(subscription.tier)
        daily_usage = _get_daily_usage(current_user.id, db)
        
        if daily_usage >= daily_limit:
            raise HTTPException(
                status_code=429,
                detail=f"Daily generation limit ({daily_limit}) reached. Upgrade for more generations."
            )
        
        # Content safety validation
        if not validate_content_safety(request.prompt):
            raise HTTPException(
                status_code=400,
                detail="Content violates safety guidelines. Please revise your prompt."
            )
        
        # Generate cache key
        cache_key = hashlib.md5(
            f"{request.prompt}{request.content_type}{sorted(request.platforms)}{request.tone}{request.language}".encode()
        ).hexdigest()
        
        # Check cache first
        if cache_key in content_cache:
            logger.info(f"Returning cached content for request {request_id}")
            cached_response = content_cache[cache_key]
            cached_response.request_id = request_id
            return cached_response
        
        generated_items = []
        total_tokens_used = 0
        
        # Try AI generation first, fallback to offline templates
        try:
            # Prepare generation parameters
            generation_params = {
                'content_type': request.content_type.value,
                'platforms': [p.value for p in request.platforms],
                'tone': request.tone.value,
                'target_audience': request.target_audience,
                'language': request.language,
                'brand_voice': request.brand_voice,
                'max_tokens': request.character_limit or 1000,
                'temperature': 0.8
            }
            
            # Generate content with primary AI service
            ai_result = await ai_generator.generate_with_openai(request.prompt, generation_params)
            
            if not ai_result:
                # Fallback to Claude
                ai_result = await ai_generator.generate_with_claude(request.prompt, generation_params)
            
            if ai_result:
                # Parse AI-generated content
                generated_content = ai_result['content']
                total_tokens_used = ai_result.get('tokens_used', 0)
                
                # Split content into variations
                variations = _parse_ai_variations(generated_content, request.variations_count)
                
                # Process each variation for each platform
                for platform in request.platforms:
                    for i, variation in enumerate(variations):
                        optimized_content = _optimize_for_platform(variation, platform.value, request)
                        
                        # Analyze content performance
                        analysis = analyze_content_performance(optimized_content, platform.value)
                        
                        # Extract hashtags
                        hashtags = extract_hashtags(optimized_content)
                        
                        # Create content item
                        content_item = GeneratedContentItem(
                            id=str(uuid.uuid4()),
                            content=optimized_content,
                            platform=platform,
                            character_count=calculate_character_count(optimized_content),
                            hashtags=hashtags,
                            engagement_score=analysis['engagement_score'],
                            readability_score=analysis['readability_score'],
                            sentiment_score=analysis['sentiment_score'],
                            language=request.language,
                            created_at=datetime.now()
                        )
                        
                        generated_items.append(content_item)
            else:
                # Fallback to offline generation
                logger.info("Using offline content generation")
                offline_variations = await ai_generator.generate_offline_content(request)
                
                for platform in request.platforms:
                    for variation in offline_variations:
                        optimized_content = _optimize_for_platform(variation['content'], platform.value, request)
                        
                        content_item = GeneratedContentItem(
                            id=variation['id'],
                            content=optimized_content,
                            platform=platform,
                            character_count=calculate_character_count(optimized_content),
                            hashtags=variation['hashtags'],
                            engagement_score=variation['engagement_score'],
                            readability_score=variation['readability_score'],
                            sentiment_score=variation['sentiment_score'],
                            language=request.language,
                            created_at=datetime.now()
                        )
                        
                        generated_items.append(content_item)
        
        except Exception as e:
            logger.error(f"AI generation failed: {str(e)}")
            # Fallback to offline generation
            offline_variations = await ai_generator.generate_offline_content(request)
            
            for platform in request.platforms:
                for variation in offline_variations:
                    optimized_content = _optimize_for_platform(variation['content'], platform.value, request)
                    
                    content_item = GeneratedContentItem(
                        id=variation['id'],
                        content=optimized_content,
                        platform=platform,
                        character_count=calculate_character_count(optimized_content),
                        hashtags=variation['hashtags'],
                        engagement_score=variation['engagement_score'],
                        readability_score=variation['readability_score'],
                        sentiment_score=variation['sentiment_score'],
                        language=request.language,
                        created_at=datetime.now()
                    )
                    
                    generated_items.append(content_item)
        
        # Calculate credits used
        credits_used = _calculate_credits_used(len(generated_items), total_tokens_used, subscription.tier)
        remaining_credits = daily_limit - daily_usage - credits_used
        
        # Generate optimization suggestions
        optimization_suggestions = _generate_optimization_suggestions(generated_items)
        
        # Calculate processing time
        processing_time = (datetime.now() - start_time).total_seconds()
        
        # Create response
        response = ContentGenerationResponse(
            request_id=request_id,
            total_variations=len(generated_items),
            generated_content=generated_items,
            processing_time=processing_time,
            credits_used=credits_used,
            remaining_credits=max(0, remaining_credits),
            optimization_suggestions=optimization_suggestions
        )
        
        # Cache the response
        content_cache[cache_key] = response
        
        # Save to database (background task)
        background_tasks.add_task(
            _save_generated_content,
            current_user.id,
            request_id,
            generated_items,
            credits_used,
            db
        )
        
        # Update usage statistics
        background_tasks.add_task(_update_usage_stats, current_user.id, credits_used, db)
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Content generation error: {str(e)}")
        raise HTTPException(status_code=500, detail="Content generation failed")

@router.post("/bulk-generate")
async def bulk_generate_content(
    request: BulkContentRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Generate content for multiple prompts in bulk"""
    
    # Verify enterprise tier for bulk operations
    subscription = verify_subscription_tier(current_user, db)
    if subscription.tier not in ['premium', 'enterprise']:
        raise HTTPException(
            status_code=403,
            detail="Bulk generation requires Premium or Enterprise subscription"
        )
    
    bulk_results = []
    
    for prompt in request.prompts:
        individual_request = ContentGenerationRequest(
            prompt=prompt,
            content_type=request.content_type,
            platforms=request.platforms,
            tone=request.tone,
            language=request.language,
            variations_count=request.variations_per_prompt
        )
        
        try:
            result = await generate_content(individual_request, background_tasks, current_user, db)
            bulk_results.append({
                'prompt': prompt,
                'status': 'success',
                'result': result
            })
        except Exception as e:
            bulk_results.append({
                'prompt': prompt,
                'status': 'failed',
                'error': str(e)
            })
    
    return {
        'total_prompts': len(request.prompts),
        'successful': len([r for r in bulk_results if r['status'] == 'success']),
        'failed': len([r for r in bulk_results if r['status'] == 'failed']),
        'results': bulk_results
    }

@router.get("/templates")
async def get_content_templates(
    content_type: Optional[ContentType] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get available content templates"""
    
    query = db.query(ContentTemplate).filter(
        or_(
            ContentTemplate.user_id == current_user.id,
            ContentTemplate.is_public == True
        )
    )
    
    if content_type:
        query = query.filter(ContentTemplate.content_type == content_type.value)
    
    templates = query.order_by(desc(ContentTemplate.created_at)).all()
    
    return {
        'templates': [
            {
                'id': t.id,
                'name': t.name,
                'template': t.template,
                'content_type': t.content_type,
                'variables': t.variables,
                'is_public': t.is_public,
                'usage_count': t.usage_count,
                'created_at': t.created_at
            }
            for t in templates
        ]
    }

@router.post("/templates")
async def create_content_template(
    request: ContentTemplateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new content template"""
    
    # Verify template doesn't already exist
    existing = db.query(ContentTemplate).filter(
        and_(
            ContentTemplate.user_id == current_user.id,
            ContentTemplate.name == request.name
        )
    ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail="Template with this name already exists")
    
    template = ContentTemplate(
        user_id=current_user.id,
        name=request.name,
        template=request.template,
        content_type=request.content_type.value,
        variables=request.variables or {},
        is_public=request.is_public
    )
    
    db.add(template)
    db.commit()
    db.refresh(template)
    
    return {
        'id': template.id,
        'message': 'Template created successfully'
    }

@router.get("/analytics/{content_id}")
async def get_content_analytics(
    content_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get analytics for specific content"""
    
    content = db.query(GeneratedContent).filter(
        and_(
            GeneratedContent.id == content_id,
            GeneratedContent.user_id == current_user.id
        )
    ).first()
    
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    
    # Get performance metrics from content analysis
    performance_metrics = {
        'engagement_score': content.engagement_score,
        'readability_score': content.readability_score,
        'sentiment_score': content.sentiment_score,
        'character_count': len(content.content),
        'hashtag_count': len(content.hashtags) if content.hashtags else 0,
        'platform': content.platform
    }
    
    # Generate recommendations based on content analysis
    recommendations = []
    if content.engagement_score < 0.7:
        recommendations.append("Add a question to increase engagement")
    if content.readability_score < 0.7:
        recommendations.append("Simplify sentence structures for better readability")
    if content.sentiment_score < 0.4:
        recommendations.append("Use more positive language to improve sentiment")
    if content.sentiment_score > 0.8:
        recommendations.append("Consider toning down overly positive language for authenticity")
    
    # Add platform-specific recommendations
    if content.platform == 'twitter' and len(content.content) > 250:
        recommendations.append("For Twitter, keep content under 250 characters for better engagement")
    if content.platform == 'instagram' and content.hashtags and len(content.hashtags) < 5:
        recommendations.append("Add more relevant hashtags (5-10) for better discoverability")
    
    # Extract trending elements from content
    trending_elements = []
    if content.hashtags:
        hashtags = content.hashtags.split(',')[:10]  # Get first 10 hashtags
        for tag in hashtags:
            # Check if hashtag is trending in the database
            trending = db.query(TrendingTopic).filter(
                TrendingTopic.tag == tag,
                TrendingTopic.platform == content.platform
            ).first()
            if trending and trending.trend_score > 0.7:  # Highly trending
                trending_elements.append(tag)
    
    # Simulated competitor analysis
    competitor_analysis = {
        'top_performers': [
            {'username': 'competitor1', 'engagement': 0.85},
            {'username': 'competitor2', 'engagement': 0.82}
        ],
        'average_engagement': 0.75,
        'comparison': 'Your content is performing above average' if content.engagement_score >= 0.75 else 'Your content is below average'
    }
    
    # Save analytics to content record
    content.last_analyzed = datetime.now()
    db.commit()
    
    return ContentAnalyticsResponse(
        content_id=content_id,
        performance_metrics=performance_metrics,
        recommendations=recommendations,
        trending_elements=trending_elements,
        competitor_analysis=competitor_analysis
    )

# Helper Functions Implementation

def _save_generated_content(
    user_id: str,
    request_id: str,
    generated_items: List[GeneratedContentItem],
    credits_used: int,
    db: Session
):
    """Save generated content to the database"""
    try:
        for item in generated_items:
            db_content = GeneratedContent(
                id=item.id,
                user_id=user_id,
                request_id=request_id,
                content=encrypt_sensitive_data(item.content),  # Encrypt content
                platform=item.platform.value,
                character_count=item.character_count,
                hashtags=','.join(item.hashtags),
                engagement_score=item.engagement_score,
                readability_score=item.readability_score,
                sentiment_score=item.sentiment_score,
                language=item.language,
                created_at=item.created_at,
                credits_used=credits_used / len(generated_items)  # Divide credits equally
            )
            db.add(db_content)
        db.commit()
    except Exception as e:
        logger.error(f"Failed to save generated content: {str(e)}")
        db.rollback()

def _update_usage_stats(user_id: str, credits_used: int, db: Session):
    """Update user's usage statistics"""
    try:
        # Find today's usage record for the user
        today = datetime.utcnow().date()
        usage = db.query(UserSubscription).filter(
            and_(
                UserSubscription.user_id == user_id,
                UserSubscription.date == today
            )
        ).first()
        
        if usage:
            usage.generations_today += 1
            usage.credits_used_today += credits_used
        else:
            usage = UserSubscription(
                user_id=user_id,
                date=today,
                generations_today=1,
                credits_used_today=credits_used
            )
            db.add(usage)
        
        db.commit()
    except Exception as e:
        logger.error(f"Failed to update usage stats: {str(e)}")
        db.rollback()

def _get_daily_usage(user_id: str, db: Session) -> int:
    """Get today's usage for a user"""
    today = datetime.utcnow().date()
    usage = db.query(UserSubscription).filter(
        and_(
            UserSubscription.user_id == user_id,
            UserSubscription.date == today
        )
    ).first()
    
    if usage:
        return usage.credits_used_today
    return 0

def _get_daily_generation_limit(tier: str) -> int:
    """Get daily generation limit based on subscription tier"""
    limits = {
        'freemium': 20,
        'premium': 200,
        'enterprise': 2000
    }
    return limits.get(tier, 20)

def _optimize_for_platform(content: str, platform: str, request: ContentGenerationRequest) -> str:
    """Apply platform-specific optimizations to content"""
    # Platform-specific rules
    if platform == 'twitter':
        # Ensure content is within 280 characters
        content = content[:280]
        # Add trending hashtags if available
        if request.include_hashtags and request.keywords:
            hashtags = ['#' + kw for kw in request.keywords][:3]
            content += ' ' + ' '.join(hashtags)
    elif platform == 'instagram':
        # Add line breaks for readability
        content = content.replace('. ', '.\n\n')
        # Add relevant emojis
        if request.include_emojis:
            content = "✨ " + content + " ✨"
    elif platform == 'tiktok':
        # Add trending hashtags
        if request.include_hashtags:
            content += " #fyp #viral #trending"
    elif platform == 'linkedin':
        # Make it more professional
        content = content.replace("!", ".").replace("?", ".")
        if request.include_hashtags and request.keywords:
            hashtags = ['#' + kw for kw in request.keywords][:5]
            content += '\n\n' + ' '.join(hashtags)
    
    return content

def _parse_ai_variations(ai_content: str, expected_variations: int) -> List[str]:
    """Parse the AI-generated content into individual variations"""
    # Split variations based on common separators
    variations = []
    
    # Try different splitting strategies
    if '---' in ai_content:
        variations = ai_content.split('---')
    elif 'Variation' in ai_content:
        variations = re.split(r'Variation \d+:', ai_content)
    elif '\n\n' in ai_content:
        variations = ai_content.split('\n\n')
    else:
        variations = [ai_content]
    
    # Clean and filter variations
    variations = [v.strip() for v in variations if v.strip()]
    
    # Ensure we have the expected number of variations
    if len(variations) > expected_variations:
        variations = variations[:expected_variations]
    elif len(variations) < expected_variations:
        # Duplicate the last variation to meet the count
        while len(variations) < expected_variations:
            variations.append(variations[-1])
    
    return variations

def _calculate_credits_used(num_variations: int, tokens_used: int, tier: str) -> int:
    """Calculate credits used for the generation"""
    # Base credits per variation
    base_credits = 1
    
    # Token-based credits: 1 credit per 100 tokens
    token_credits = max(1, tokens_used // 100)
    
    # Tier multiplier: freemium pays more credits
    multiplier = {
        'freemium': 2,
        'premium': 1,
        'enterprise': 0.5
    }.get(tier, 1)
    
    total_credits = int((base_credits * num_variations + token_credits) * multiplier)
    return total_credits

def _generate_optimization_suggestions(content_items: List[GeneratedContentItem]) -> List[str]:
    """Generate optimization suggestions based on content analysis"""
    suggestions = []
    
    for item in content_items:
        if item.engagement_score < 0.6:
            suggestions.append(f"Add a call-to-action for {item.platform.value} content")
        if item.sentiment_score < 0.3:
            suggestions.append("Use more positive language to improve engagement")
        if item.readability_score < 0.6:
            suggestions.append("Simplify sentence structures for better readability")
        if len(item.hashtags) < 3:
            suggestions.append(f"Add more relevant hashtags for {item.platform.value}")
        if item.character_count > 200 and item.platform in ['twitter', 'tiktok']:
            suggestions.append(f"Shorten content for {item.platform.value} (ideal: <200 chars)")
    
    # Deduplicate and limit suggestions
    return list(set(suggestions))[:5]

# Content Safety Validation
def validate_content_safety(content: str) -> bool:
    """Validate content against safety guidelines"""
    # Blocklist of prohibited terms
    blocklist = [
        'hate speech', 'discrimination', 'violence', 'harassment',
        'illegal activities', 'child exploitation', 'terrorism'
    ]
    
    # Check for blocklisted terms
    for term in blocklist:
        if term in content.lower():
            return False
    
    # Additional safety checks
    if any(word in content.lower() for word in ['kill', 'murder', 'attack']):
        return False
    
    # Check for excessive aggression
    aggressive_words = ['hate', 'stupid', 'idiot', 'worthless']
    if sum(content.lower().count(word) for word in aggressive_words) > 3:
        return False
    
    return True

# Offline Content Storage
def store_content_for_offline(user_id: str, content: GeneratedContentItem, db: Session):
    """Store content for offline access"""
    try:
        # Check if content already exists
        existing = db.query(GeneratedContent).filter(
            GeneratedContent.id == content.id
        ).first()
        
        if not existing:
            db_content = GeneratedContent(
                id=content.id,
                user_id=user_id,
                content=content.content,
                platform=content.platform.value,
                character_count=content.character_count,
                hashtags=','.join(content.hashtags),
                engagement_score=content.engagement_score,
                readability_score=content.readability_score,
                sentiment_score=content.sentiment_score,
                language=content.language,
                created_at=content.created_at,
                is_offline=True
            )
            db.add(db_content)
            db.commit()
    except Exception as e:
        logger.error(f"Failed to store content for offline: {str(e)}")
        db.rollback()

# Endpoint to get offline content
@router.get("/offline-content", response_model=List[GeneratedContentItem])
async def get_offline_content(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get content stored for offline access"""
    offline_content = db.query(GeneratedContent).filter(
        and_(
            GeneratedContent.user_id == current_user.id,
            GeneratedContent.is_offline == True
        )
    ).order_by(desc(GeneratedContent.created_at)).limit(50).all()
    
    return [
        GeneratedContentItem(
            id=content.id,
            content=content.content,
            platform=content.platform,
            character_count=content.character_count,
            hashtags=content.hashtags.split(','),
            engagement_score=content.engagement_score,
            readability_score=content.readability_score,
            sentiment_score=content.sentiment_score,
            language=content.language,
            created_at=content.created_at
        )
        for content in offline_content
    ]

# Endpoint to delete offline content
@router.delete("/offline-content/{content_id}")
async def delete_offline_content(
    content_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete offline content"""
    content = db.query(GeneratedContent).filter(
        and_(
            GeneratedContent.id == content_id,
            GeneratedContent.user_id == current_user.id,
            GeneratedContent.is_offline == True
        )
    ).first()
    
    if content:
        db.delete(content)
        db.commit()
        return {"message": "Content deleted successfully"}
    
    raise HTTPException(status_code=404, detail="Offline content not found")

# Content History Endpoint
@router.get("/history", response_model=List[GeneratedContentItem])
async def get_content_history(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get user's content generation history"""
    offset = (page - 1) * per_page
    history = db.query(GeneratedContent).filter(
        GeneratedContent.user_id == current_user.id
    ).order_by(desc(GeneratedContent.created_at)).offset(offset).limit(per_page).all()
    
    return [
        GeneratedContentItem(
            id=content.id,
            content=content.content,
            platform=content.platform,
            character_count=content.character_count,
            hashtags=content.hashtags.split(','),
            engagement_score=content.engagement_score,
            readability_score=content.readability_score,
            sentiment_score=content.sentiment_score,
            language=content.language,
            created_at=content.created_at
        )
        for content in history
    ]