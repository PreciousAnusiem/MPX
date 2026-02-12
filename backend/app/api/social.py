import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Union, Any
from dataclasses import dataclass
from enum import Enum
import hashlib
import base64
from urllib.parse import urlencode

import aiohttp
import aiofiles
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from cryptography.fernet import Fernet
import redis.asyncio as redis
from PIL import Image
import io

from ..config import get_settings
from ..models import SocialPost, SocialAccount, User, ContentVariation
from ..database import get_db
from ..utils import sanitize_input, validate_url, rate_limiter
from .ai_service import AIService

settings = get_settings()
logger = logging.getLogger(__name__)

class PostStatus(Enum):
    DRAFT = "draft"
    SCHEDULED = "scheduled"
    PUBLISHING = "publishing"
    PUBLISHED = "published"
    FAILED = "failed"
    DELETED = "deleted"

class PlatformType(Enum):
    INSTAGRAM = "instagram"
    TIKTOK = "tiktok"
    TWITTER = "twitter"
    FACEBOOK = "facebook"
    LINKEDIN = "linkedin"
    YOUTUBE = "youtube"
    PINTEREST = "pinterest"
    SNAPCHAT = "snapchat"
    THREADS = "threads"
    AMAZON_LIVE = "amazon_live"

@dataclass
class PostContent:
    text: str
    media_urls: List[str]
    hashtags: List[str]
    mentions: List[str]
    link: Optional[str] = None
    location: Optional[str] = None
    alt_text: Optional[str] = None

@dataclass
class PlatformConfig:
    max_text_length: int
    max_hashtags: int
    supported_media_types: List[str]
    max_media_count: int
    requires_approval: bool
    api_version: str

class SocialService:
    def __init__(self):
        self.redis_client = redis.from_url(settings.REDIS_URL)
        self.ai_service = AIService()
        self.encryption_key = Fernet(settings.ENCRYPTION_KEY.encode())
        self.platform_configs = self._init_platform_configs()
        self.session = None
        self.offline_queue = asyncio.Queue()
        
    async def __aenter__(self):
        """Async context manager entry"""
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=30),
            headers={
                'User-Agent': 'ONXLink/1.0 Social Manager',
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        )
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        if self.session:
            await self.session.close()
        await self.redis_client.close()

    def _init_platform_configs(self) -> Dict[PlatformType, PlatformConfig]:
        """Initialize platform-specific configurations"""
        return {
            PlatformType.INSTAGRAM: PlatformConfig(
                max_text_length=2200,
                max_hashtags=30,
                supported_media_types=['image/jpeg', 'image/png', 'video/mp4'],
                max_media_count=10,
                requires_approval=False,
                api_version='v18.0'
            ),
            PlatformType.TIKTOK: PlatformConfig(
                max_text_length=4000,
                max_hashtags=100,
                supported_media_types=['video/mp4', 'image/jpeg'],
                max_media_count=1,
                requires_approval=True,
                api_version='v1.3'
            ),
            PlatformType.TWITTER: PlatformConfig(
                max_text_length=280,
                max_hashtags=10,
                supported_media_types=['image/jpeg', 'image/png', 'video/mp4', 'image/gif'],
                max_media_count=4,
                requires_approval=False,
                api_version='v2'
            ),
            PlatformType.FACEBOOK: PlatformConfig(
                max_text_length=63206,
                max_hashtags=30,
                supported_media_types=['image/jpeg', 'image/png', 'video/mp4'],
                max_media_count=10,
                requires_approval=False,
                api_version='v18.0'
            ),
            PlatformType.LINKEDIN: PlatformConfig(
                max_text_length=3000,
                max_hashtags=30,
                supported_media_types=['image/jpeg', 'image/png', 'video/mp4'],
                max_media_count=9,
                requires_approval=False,
                api_version='v2'
            ),
            PlatformType.YOUTUBE: PlatformConfig(
                max_text_length=5000,
                max_hashtags=15,
                supported_media_types=['video/mp4', 'video/mov'],
                max_media_count=1,
                requires_approval=True,
                api_version='v3'
            ),
            PlatformType.PINTEREST: PlatformConfig(
                max_text_length=500,
                max_hashtags=20,
                supported_media_types=['image/jpeg', 'image/png'],
                max_media_count=1,
                requires_approval=False,
                api_version='v5'
            ),
            PlatformType.SNAPCHAT: PlatformConfig(
                max_text_length=80,
                max_hashtags=5,
                supported_media_types=['image/jpeg', 'video/mp4'],
                max_media_count=1,
                requires_approval=True,
                api_version='v1'
            ),
            PlatformType.THREADS: PlatformConfig(
                max_text_length=500,
                max_hashtags=10,
                supported_media_types=['image/jpeg', 'image/png', 'video/mp4'],
                max_media_count=10,
                requires_approval=False,
                api_version='v1.0'
            ),
            PlatformType.AMAZON_LIVE: PlatformConfig(
                max_text_length=1000,
                max_hashtags=10,
                supported_media_types=['video/mp4', 'image/jpeg'],
                max_media_count=1,
                requires_approval=True,
                api_version='v1'
            )
        }

    @rate_limiter(max_calls=100, time_window=60)
    async def create_multi_platform_post(
        self,
        db: AsyncSession,
        user_id: str,
        content: PostContent,
        platforms: List[PlatformType],
        schedule_time: Optional[datetime] = None,
        auto_optimize: bool = True
    ) -> Dict[str, Any]:
        """Create optimized posts for multiple platforms"""
        try:
            # Validate input
            content.text = sanitize_input(content.text)
            if content.link:
                content.link = validate_url(content.link)
            
            # Get user's connected accounts
            connected_accounts = await self._get_connected_accounts(db, user_id, platforms)
            if not connected_accounts:
                # Offline mode: Queue for later processing
                await self._queue_offline_post(user_id, content, platforms, schedule_time)
                return {
                    'success': True,
                    'status': 'queued_offline',
                    'message': 'Post queued for processing when online'
                }
            
            results = {}
            post_variations = {}
            
            # Generate platform-specific content variations
            if auto_optimize:
                for platform in platforms:
                    if platform in connected_accounts:
                        optimized_content = await self._optimize_content_for_platform(
                            content, platform, user_id
                        )
                        post_variations[platform] = optimized_content
            else:
                for platform in platforms:
                    post_variations[platform] = content
            
            # Create posts for each platform
            for platform, optimized_content in post_variations.items():
                try:
                    if schedule_time:
                        # Schedule post
                        post_result = await self._schedule_post(
                            db, user_id, platform, optimized_content, schedule_time
                        )
                    else:
                        # Publish immediately
                        post_result = await self._publish_post(
                            db, user_id, platform, optimized_content
                        )
                    
                    results[platform.value] = {
                        'status': 'success',
                        'post_id': post_result.get('post_id'),
                        'platform_post_id': post_result.get('platform_post_id'),
                        'url': post_result.get('url'),
                        'scheduled_for': schedule_time.isoformat() if schedule_time else None
                    }
                    
                except Exception as e:
                    logger.error(f"Failed to post to {platform.value}: {str(e)}")
                    results[platform.value] = {
                        'status': 'error',
                        'error': str(e),
                        'retry_available': True
                    }
            
            # Cache results for offline access
            await self._cache_post_results(user_id, results)
            
            return {
                'success': True,
                'results': results,
                'total_platforms': len(platforms),
                'successful_posts': len([r for r in results.values() if r['status'] == 'success']),
                'failed_posts': len([r for r in results.values() if r['status'] == 'error'])
            }
            
        except Exception as e:
            logger.error(f"Multi-platform post creation failed: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'results': {}
            }

    async def _optimize_content_for_platform(
        self,
        content: PostContent,
        platform: PlatformType,
        user_id: str
    ) -> PostContent:
        """Optimize content for specific platform requirements"""
        config = self.platform_configs[platform]
        
        # Get user preferences and past performance data
        user_data = await self._get_user_platform_data(user_id, platform)
        
        # AI-powered content optimization
        optimization_prompt = f"""
        Optimize this social media content for {platform.value}:
        
        Original text: {content.text}
        Platform limits: {config.max_text_length} characters, {config.max_hashtags} hashtags
        User's best performing content style: {user_data.get('top_performing_style', 'engaging')}
        Target audience: {user_data.get('audience_demographics', 'general')}
        
        Requirements:
        1. Keep the core message intact
        2. Adapt tone and style for {platform.value}
        3. Optimize hashtags for platform algorithm
        4. Ensure character limit compliance
        5. Include trending keywords if relevant
        
        Return optimized content maintaining authenticity.
        """
        
        try:
            optimized_text = await self.ai_service.generate_content(
                optimization_prompt,
                max_length=config.max_text_length - 50  # Buffer for hashtags
            )
            
            # Optimize hashtags
            optimized_hashtags = await self._optimize_hashtags(
                content.hashtags, platform, config.max_hashtags
            )
            
            # Validate and resize media if needed
            optimized_media_urls = await self._optimize_media_for_platform(
                content.media_urls, platform
            )
            
            return PostContent(
                text=optimized_text,
                media_urls=optimized_media_urls,
                hashtags=optimized_hashtags,
                mentions=content.mentions[:5],  # Limit mentions
                link=content.link,
                location=content.location,
                alt_text=content.alt_text
            )
            
        except Exception as e:
            logger.warning(f"Content optimization failed for {platform.value}, using original: {e}")
            return self._truncate_content_for_platform(content, config)

    async def _optimize_hashtags(
        self,
        hashtags: List[str],
        platform: PlatformType,
        max_count: int
    ) -> List[str]:
        """Optimize hashtags for platform-specific performance"""
        if not hashtags:
            return []
        
        # Get trending hashtags for platform
        trending = await self._get_trending_hashtags(platform)
        
        # Score hashtags based on relevance and performance
        scored_hashtags = []
        for tag in hashtags[:max_count]:
            score = 1.0
            
            # Boost score for trending hashtags
            if tag.lower() in [t.lower() for t in trending]:
                score += 0.5
            
            # Platform-specific scoring
            if platform == PlatformType.INSTAGRAM and len(tag) > 15:
                score -= 0.2  # Instagram prefers shorter hashtags
            elif platform == PlatformType.TIKTOK and len(tag) < 8:
                score += 0.3  # TikTok performs better with longer hashtags
            
            scored_hashtags.append((tag, score))
        
        # Sort by score and return top hashtags
        scored_hashtags.sort(key=lambda x: x[1], reverse=True)
        return [tag for tag, _ in scored_hashtags[:max_count]]

    async def _optimize_media_for_platform(
        self,
        media_urls: List[str],
        platform: PlatformType
    ) -> List[str]:
        """Optimize media files for platform requirements"""
        if not media_urls:
            return []
        
        config = self.platform_configs[platform]
        optimized_urls = []
        
        for url in media_urls[:config.max_media_count]:
            try:
                # Download and process media
                optimized_url = await self._process_media_file(url, platform)
                optimized_urls.append(optimized_url)
            except Exception as e:
                logger.warning(f"Media optimization failed for {url}: {e}")
                optimized_urls.append(url)  # Use original if optimization fails
        
        return optimized_urls

    async def _process_media_file(self, url: str, platform: PlatformType) -> str:
        """Process and optimize media file for platform"""
        config = self.platform_configs[platform]
        
        async with self.session.get(url) as response:
            if response.status != 200:
                return url
            
            content = await response.read()
            
            # Determine media type
            content_type = response.headers.get('content-type', '')
            
            if content_type.startswith('image/'):
                return await self._optimize_image(content, platform)
            elif content_type.startswith('video/'):
                return await self._optimize_video(content, platform)
            else:
                return url

    async def _optimize_image(self, image_data: bytes, platform: PlatformType) -> str:
        """Optimize image for platform specifications"""
        try:
            image = Image.open(io.BytesIO(image_data))
            
            # Platform-specific image optimization
            if platform == PlatformType.INSTAGRAM:
                # Instagram optimal: 1080x1080 for square, 1080x1350 for portrait
                if image.width == image.height:
                    target_size = (1080, 1080)
                else:
                    target_size = (1080, 1350)
            elif platform == PlatformType.TWITTER:
                # Twitter optimal: 1200x675
                target_size = (1200, 675)
            elif platform == PlatformType.LINKEDIN:
                # LinkedIn optimal: 1200x627
                target_size = (1200, 627)
            else:
                # Default optimization
                target_size = (1080, 1080)
            
            # Resize and optimize
            optimized_image = image.resize(target_size, Image.Resampling.LANCZOS)
            
            # Save optimized image
            output_buffer = io.BytesIO()
            optimized_image.save(output_buffer, format='JPEG', quality=85)
            
            # Upload optimized image and return new URL
            return await self._upload_optimized_media(output_buffer.getvalue(), 'image/jpeg')
            
        except Exception as e:
            logger.error(f"Image optimization failed: {e}")
            raise

    async def _optimize_video(self, video_data: bytes, platform: PlatformType) -> str:
        """Optimize video for platform specifications"""
        # Video optimization would typically use ffmpeg
        # For now, return original URL (implement video processing as needed)
        return await self._upload_optimized_media(video_data, 'video/mp4')

    async def _upload_optimized_media(self, media_data: bytes, content_type: str) -> str:
        """Upload optimized media to CDN and return URL"""
        # This would typically upload to AWS S3, Cloudinary, or similar service
        # For now, return a placeholder URL
        file_hash = hashlib.md5(media_data).hexdigest()
        return f"{settings.CDN_BASE_URL}/optimized/{file_hash}"

    async def _publish_post(
        self,
        db: AsyncSession,
        user_id: str,
        platform: PlatformType,
        content: PostContent
    ) -> Dict[str, Any]:
        """Publish post to specific platform"""
        try:
            # Get platform credentials
            account = await self._get_platform_account(db, user_id, platform)
            if not account:
                raise ValueError(f"No {platform.value} account connected")
            
            # Decrypt credentials
            credentials = self._decrypt_credentials(account.encrypted_credentials)
            
            # Platform-specific posting
            if platform == PlatformType.INSTAGRAM:
                result = await self._post_to_instagram(content, credentials)
            elif platform == PlatformType.TIKTOK:
                result = await self._post_to_tiktok(content, credentials)
            elif platform == PlatformType.TWITTER:
                result = await self._post_to_twitter(content, credentials)
            elif platform == PlatformType.FACEBOOK:
                result = await self._post_to_facebook(content, credentials)
            elif platform == PlatformType.LINKEDIN:
                result = await self._post_to_linkedin(content, credentials)
            elif platform == PlatformType.YOUTUBE:
                result = await self._post_to_youtube(content, credentials)
            elif platform == PlatformType.PINTEREST:
                result = await self._post_to_pinterest(content, credentials)
            elif platform == PlatformType.SNAPCHAT:
                result = await self._post_to_snapchat(content, credentials)
            elif platform == PlatformType.THREADS:
                result = await self._post_to_threads(content, credentials)
            elif platform == PlatformType.AMAZON_LIVE:
                result = await self._post_to_amazon_live(content, credentials)
            else:
                raise ValueError(f"Unsupported platform: {platform.value}")
            
            # Save post record
            post_record = SocialPost(
                user_id=user_id,
                platform=platform.value,
                content=content.text,
                media_urls=content.media_urls,
                hashtags=content.hashtags,
                platform_post_id=result['platform_post_id'],
                status=PostStatus.PUBLISHED.value,
                published_at=datetime.utcnow(),
                metrics={}
            )
            
            db.add(post_record)
            await db.commit()
            
            return {
                'post_id': post_record.id,
                'platform_post_id': result['platform_post_id'],
                'url': result.get('url'),
                'status': 'published'
            }
            
        except Exception as e:
            logger.error(f"Failed to publish to {platform.value}: {str(e)}")
            # Queue for retry when online
            await self._queue_offline_post(
                user_id, content, [platform], None
            )
            return {
                'post_id': None,
                'platform_post_id': None,
                'url': None,
                'status': 'queued'
            }

    async def _post_to_instagram(self, content: PostContent, credentials: Dict) -> Dict:
        """Post to Instagram using Graph API"""
        access_token = credentials['access_token']
        instagram_business_account = credentials['instagram_business_account_id']
        
        # Step 1: Create media container
        if content.media_urls:
            media_url = content.media_urls[0]  # Instagram posts typically have one main media
            
            container_data = {
                'image_url': media_url,
                'caption': f"{content.text}\n\n{' '.join(['#' + tag for tag in content.hashtags])}",
                'access_token': access_token
            }
            
            if content.location:
                container_data['location_id'] = content.location
            
            async with self.session.post(
                f"https://graph.facebook.com/v18.0/{instagram_business_account}/media",
                data=container_data
            ) as response:
                container_result = await response.json()
                
                if response.status != 200:
                    raise Exception(f"Instagram container creation failed: {container_result}")
                
                container_id = container_result['id']
        
            # Step 2: Publish the media container
            publish_data = {
                'creation_id': container_id,
                'access_token': access_token
            }
            
            async with self.session.post(
                f"https://graph.facebook.com/v18.0/{instagram_business_account}/media_publish",
                data=publish_data
            ) as response:
                publish_result = await response.json()
                
                if response.status != 200:
                    raise Exception(f"Instagram publish failed: {publish_result}")
                
                return {
                    'platform_post_id': publish_result['id'],
                    'url': f"https://www.instagram.com/p/{publish_result['id']}"
                }
        else:
            raise ValueError("Instagram posts require media")

    async def _post_to_tiktok(self, content: PostContent, credentials: Dict) -> Dict:
        """Post to TikTok using TikTok API"""
        access_token = credentials['access_token']
        
        if not content.media_urls:
            raise ValueError("TikTok posts require video content")
        
        video_url = content.media_urls[0]
        
        post_data = {
            'post_info': {
                'title': content.text,
                'privacy_level': 'SELF_ONLY',  # Start with private, user can change
                'disable_duet': False,
                'disable_comment': False,
                'disable_stitch': False,
                'video_cover_timestamp_ms': 1000
            },
            'source_info': {
                'source': 'PULL_FROM_URL',
                'video_url': video_url
            }
        }
        
        headers = {
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json'
        }
        
        async with self.session.post(
            'https://open.tiktokapis.com/v2/post/publish/video/init/',
            json=post_data,
            headers=headers
        ) as response:
            result = await response.json()
            
            if response.status != 200:
                raise Exception(f"TikTok post failed: {result}")
            
            return {
                'platform_post_id': result['data']['publish_id'],
                'url': f"https://www.tiktok.com/@username/video/{result['data']['publish_id']}"
            }

    async def _post_to_twitter(self, content: PostContent, credentials: Dict) -> Dict:
        """Post to Twitter using Twitter API v2"""
        bearer_token = credentials['bearer_token']
        
        tweet_data = {
            'text': f"{content.text}\n\n{' '.join(['#' + tag for tag in content.hashtags[:10]])}"
        }
        
        # Add media if available
        if content.media_urls:
            # Upload media first (simplified - would need proper media upload)
            tweet_data['media'] = {
                'media_ids': ['placeholder_media_id']  # Would need actual media upload
            }
        
        headers = {
            'Authorization': f'Bearer {bearer_token}',
            'Content-Type': 'application/json'
        }
        
        async with self.session.post(
            'https://api.twitter.com/2/tweets',
            json=tweet_data,
            headers=headers
        ) as response:
            result = await response.json()
            
            if response.status != 201:
                raise Exception(f"Twitter post failed: {result}")
            
            tweet_id = result['data']['id']
            return {
                'platform_post_id': tweet_id,
                'url': f"https://twitter.com/user/status/{tweet_id}"
            }

    async def _post_to_facebook(self, content: PostContent, credentials: Dict) -> Dict:
        """Post to Facebook using Graph API"""
        access_token = credentials['access_token']
        page_id = credentials['page_id']
        
        post_data = {
            'message': f"{content.text}\n\n{' '.join(['#' + tag for tag in content.hashtags])}",
            'access_token': access_token
        }
        
        if content.link:
            post_data['link'] = content.link
        
        if content.media_urls:
            post_data['url'] = content.media_urls[0]
        
        async with self.session.post(
            f'https://graph.facebook.com/v18.0/{page_id}/feed',
            data=post_data
        ) as response:
            result = await response.json()
            
            if response.status != 200:
                raise Exception(f"Facebook post failed: {result}")
            
            return {
                'platform_post_id': result['id'],
                'url': f"https://facebook.com/{result['id']}"
            }

    async def _post_to_linkedin(self, content: PostContent, credentials: Dict) -> Dict:
        """Post to LinkedIn using LinkedIn API"""
        access_token = credentials['access_token']
        person_id = credentials['person_id']
        
        post_data = {
            'author': f'urn:li:person:{person_id}',
            'lifecycleState': 'PUBLISHED',
            'specificContent': {
                'com.linkedin.ugc.ShareContent': {
                    'shareCommentary': {
                        'text': f"{content.text}\n\n{' '.join(['#' + tag for tag in content.hashtags])}"
                    },
                    'shareMediaCategory': 'NONE'
                }
            },
            'visibility': {
                'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
            }
        }
        
        if content.media_urls:
            post_data['specificContent']['com.linkedin.ugc.ShareContent']['shareMediaCategory'] = 'IMAGE'
            # Would need to implement media upload for LinkedIn
        
        headers = {
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0'
        }
        
        async with self.session.post(
            'https://api.linkedin.com/v2/ugcPosts',
            json=post_data,
            headers=headers
        ) as response:
            result = await response.json()
            
            if response.status != 201:
                raise Exception(f"LinkedIn post failed: {result}")
            
            post_id = result['id']
            return {
                'platform_post_id': post_id,
                'url': f"https://linkedin.com/feed/update/{post_id}"
            }

    async def _post_to_youtube(self, content: PostContent, credentials: Dict) -> Dict:
        """Post to YouTube (Community posts or Shorts)"""
        # YouTube community posts or Shorts upload
        # This would require YouTube Data API v3 implementation
        return {
            'platform_post_id': 'youtube_placeholder',
            'url': 'https://youtube.com/placeholder'
        }

    async def _post_to_pinterest(self, content: PostContent, credentials: Dict) -> Dict:
        """Post to Pinterest using Pinterest API"""
        access_token = credentials['access_token']
        
        if not content.media_urls:
            raise ValueError("Pinterest posts require image content")
        
        pin_data = {
            'link': content.link or '',
            'title': content.text[:100],  # Pinterest title limit
            'description': content.text,
            'media_source': {
                'source_type': 'image_url',
                'url': content.media_urls[0]
            }
        }
        
        headers = {
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json'
        }
        
        async with self.session.post(
            'https://api.pinterest.com/v5/pins',
            json=pin_data,
            headers=headers
        ) as response:
            result = await response.json()
            
            if response.status != 201:
                raise Exception(f"Pinterest post failed: {result}")
            
            return {
                'platform_post_id': result['id'],
                'url': result['url']
            }

    async def _post_to_snapchat(self, content: PostContent, credentials: Dict) -> Dict:
        """Post to Snapchat using Snap Kit"""
        # Snapchat API implementation
        return {
            'platform_post_id': 'snapchat_placeholder',
            'url': 'https://snapchat.com/placeholder'
        }

    async def _post_to_threads(self, content: PostContent, credentials: Dict) -> Dict:
        """Post to Threads (Meta's Twitter competitor)"""
        # Threads API implementation (when available)
        return {
            'platform_post_id': 'threads_placeholder',
            'url': 'https://threads.net/placeholder'
        }

    async def _post_to_amazon_live(self, content: PostContent, credentials: Dict) -> Dict:
        """Post to Amazon Live"""
        # Amazon Live API implementation
        return {
            'platform_post_id': 'amazon_live_placeholder',
            'url': 'https://amazon.com/live/placeholder'
        }

    async def _schedule_post(
        self,
        db: AsyncSession,
        user_id: str,
        platform: PlatformType,
        content: PostContent,
        schedule_time: datetime
    ) -> Dict[str, Any]:
        """Schedule a post for later publishing"""
        try:
            # Create scheduled post record
            scheduled_post = SocialPost(
                user_id=user_id,
                platform=platform.value,
                content=content.text,
                media_urls=content.media_urls,
                hashtags=content.hashtags,
                status=PostStatus.SCHEDULED.value,
                scheduled_for=schedule_time,
                created_at=datetime.utcnow()
            )
            
            db.add(scheduled_post)
            await db.commit()
            
            # Add to Redis scheduler queue
            await self.redis_client.zadd(
                'scheduled_posts',
                {str(scheduled_post.id): schedule_time.timestamp()}
            )
            
            return {
                'post_id': scheduled_post.id,
                'platform_post_id': None,
                'url': None,
                'status': 'scheduled'
            }
            
        except Exception as e:
            logger.error(f"Failed to schedule post: {str(e)}")
            # Queue for offline processing
            await self._queue_offline_post(
                user_id, content, [platform], schedule_time
            )
            return {
                'post_id': None,
                'platform_post_id': None,
                'url': None,
                'status': 'queued_offline'
            }

    async def _get_connected_accounts(
        self,
        db: AsyncSession,
        user_id: str,
        platforms: List[PlatformType]
    ) -> List[SocialAccount]:
        """Get user's connected social accounts for specified platforms"""
        platform_values = [p.value for p in platforms]
        result = await db.execute(
            select(SocialAccount).where(
                SocialAccount.user_id == user_id,
                SocialAccount.platform.in_(platform_values),
                SocialAccount.is_active == True
            )
        )
        return result.scalars().all()

    async def _get_platform_account(
        self,
        db: AsyncSession,
        user_id: str,
        platform: PlatformType
    ) -> Optional[SocialAccount]:
        """Get a specific platform account for the user"""
        result = await db.execute(
            select(SocialAccount).where(
                SocialAccount.user_id == user_id,
                SocialAccount.platform == platform.value,
                SocialAccount.is_active == True
            )
        )
        return result.scalar_one_or_none()

    def _decrypt_credentials(self, encrypted_credentials: str) -> Dict:
        """Decrypt encrypted credentials"""
        decrypted = self.encryption_key.decrypt(encrypted_credentials.encode()).decode()
        return json.loads(decrypted)

    def _truncate_content_for_platform(
        self,
        content: PostContent,
        config: PlatformConfig
    ) -> PostContent:
        """Fallback content truncation for platform limits"""
        truncated_text = content.text[:config.max_text_length]
        truncated_hashtags = content.hashtags[:config.max_hashtags]
        truncated_media = content.media_urls[:config.max_media_count]
        return PostContent(
            text=truncated_text,
            media_urls=truncated_media,
            hashtags=truncated_hashtags,
            mentions=content.mentions,
            link=content.link,
            location=content.location,
            alt_text=content.alt_text
        )

    async def _get_user_platform_data(
        self,
        user_id: str,
        platform: PlatformType
    ) -> Dict[str, str]:
        """Get user's platform-specific data (cached)"""
        cache_key = f"user_platform_data:{user_id}:{platform.value}"
        cached_data = await self.redis_client.get(cache_key)
        if cached_data:
            return json.loads(cached_data)
        
        # Placeholder: In a real app, this would fetch from the database
        data = {
            'top_performing_style': 'engaging',
            'audience_demographics': 'general'
        }
        
        # Cache for 1 hour
        await self.redis_client.set(cache_key, json.dumps(data), ex=3600)
        return data

    async def _get_trending_hashtags(self, platform: PlatformType) -> List[str]:
        """Get trending hashtags for platform (cached)"""
        cache_key = f"trending_hashtags:{platform.value}"
        cached = await self.redis_client.get(cache_key)
        if cached:
            return json.loads(cached)
        
        # Placeholder: In a real app, this would use an API call
        # For now, return some example hashtags
        hashtags = {
            PlatformType.INSTAGRAM: ['love', 'instagood', 'photooftheday', 'fashion', 'beautiful'],
            PlatformType.TIKTOK: ['fyp', 'viral', 'tiktok', 'trending', 'foryou'],
            PlatformType.TWITTER: ['trending', 'news', 'viral', 'tech', 'politics'],
            PlatformType.FACEBOOK: ['news', 'viral', 'trending', 'love', 'photography'],
            PlatformType.LINKEDIN: ['career', 'leadership', 'innovation', 'networking', 'business'],
            PlatformType.YOUTUBE: ['trending', 'vlog', 'tutorial', 'howto', 'gaming'],
            PlatformType.PINTEREST: ['diy', 'home', 'decor', 'recipes', 'fashion'],
            PlatformType.SNAPCHAT: ['snap', 'selfie', 'story', 'fun', 'friends'],
            PlatformType.THREADS: ['threads', 'discussion', 'community', 'chat', 'talk'],
            PlatformType.AMAZON_LIVE: ['deals', 'live', 'shopping', 'discount', 'exclusive']
        }
        platform_hashtags = hashtags.get(platform, [])
        
        # Cache for 15 minutes
        await self.redis_client.set(cache_key, json.dumps(platform_hashtags), ex=900)
        return platform_hashtags

    async def _cache_post_results(self, user_id: str, results: Dict) -> None:
        """Cache post results for offline access"""
        cache_key = f"user_post_results:{user_id}:{datetime.utcnow().strftime('%Y%m%d')}"
        # Cache for 7 days
        await self.redis_client.set(cache_key, json.dumps(results), ex=604800)

    async def _queue_offline_post(
        self,
        user_id: str,
        content: PostContent,
        platforms: List[PlatformType],
        schedule_time: Optional[datetime]
    ) -> None:
        """Queue post for processing when online"""
        post_data = {
            'user_id': user_id,
            'content': content.__dict__,
            'platforms': [p.value for p in platforms],
            'schedule_time': schedule_time.isoformat() if schedule_time else None,
            'queued_at': datetime.utcnow().isoformat()
        }
        await self.offline_queue.put(post_data)
        await self.redis_client.lpush(
            f"offline_posts:{user_id}",
            json.dumps(post_data)
        )
        logger.info(f"Queued offline post for user {user_id}")

    async def process_offline_queue(self, db: AsyncSession):
        """Process queued posts when online"""
        while not self.offline_queue.empty():
            post_data = await self.offline_queue.get()
            try:
                user_id = post_data['user_id']
                content = PostContent(**post_data['content'])
                platforms = [PlatformType(p) for p in post_data['platforms']]
                schedule_time = datetime.fromisoformat(post_data['schedule_time']) if post_data['schedule_time'] else None
                
                # Attempt to post
                await self.create_multi_platform_post(
                    db,
                    user_id,
                    content,
                    platforms,
                    schedule_time
                )
                
                # Remove from offline queue
                await self.redis_client.lrem(
                    f"offline_posts:{user_id}",
                    1,
                    json.dumps(post_data)
                )
                
            except Exception as e:
                logger.error(f"Failed to process offline post: {str(e)}")

    async def get_offline_posts(self, user_id: str) -> List[Dict]:
        """Get queued offline posts for user"""
        posts = await self.redis_client.lrange(
            f"offline_posts:{user_id}", 0, -1)
        return [json.loads(p) for p in posts]

    async def retry_failed_posts(self, db: AsyncSession):
        """Retry failed posts from database"""
        result = await db.execute(
            select(SocialPost).where(
                SocialPost.status == PostStatus.FAILED.value
            )
        )
        failed_posts = result.scalars().all()
        
        for post in failed_posts:
            try:
                platforms = [PlatformType(post.platform)]
                content = PostContent(
                    text=post.content,
                    media_urls=post.media_urls,
                    hashtags=post.hashtags,
                    mentions=[]
                )
                
                # Re-attempt posting
                await self.create_multi_platform_post(
                    db,
                    post.user_id,
                    content,
                    platforms,
                    post.scheduled_for
                )
                
                # Update status
                post.status = PostStatus.PUBLISHING.value
                await db.commit()
                
            except Exception as e:
                logger.error(f"Retry failed for post {post.id}: {str(e)}")
                post.status = PostStatus.FAILED.value
                post.last_error = str(e)
                await db.commit()

    async def get_user_post_history(
        self,
        db: AsyncSession,
        user_id: str,
        limit: int = 50
    ) -> List[Dict]:
        """Get user's post history (works offline from cache)"""
        cache_key = f"user_post_history:{user_id}"
        cached = await self.redis_client.get(cache_key)
        if cached:
            return json.loads(cached)
        
        # Fetch from database if cache miss
        result = await db.execute(
            select(SocialPost).where(
                SocialPost.user_id == user_id
            ).order_by(SocialPost.created_at.desc()).limit(limit)
        )
        posts = result.scalars().all()
        
        # Format results
        history = [{
            'id': p.id,
            'platform': p.platform,
            'content': p.content[:100] + '...' if len(p.content) > 100 else p.content,
            'status': p.status,
            'created_at': p.created_at.isoformat(),
            'published_at': p.published_at.isoformat() if p.published_at else None,
            'url': p.url
        } for p in posts]
        
        # Cache for 1 hour
        await self.redis_client.set(cache_key, json.dumps(history), ex=3600)
        return history

    async def voice_controlled_bulk_delete(
        self,
        db: AsyncSession,
        user_id: str,
        voice_command: str
    ) -> Dict[str, Any]:
        """Delete posts based on natural language voice command"""
        try:
            # Parse command with AI
            parsed_command = await self.ai_service.parse_voice_command(
                voice_command,
                command_type="delete"
            )
            
            # Extract parameters
            platforms = [PlatformType(p) for p in parsed_command.get('platforms', [])]
            date_range = parsed_command.get('date_range', {})
            content_keywords = parsed_command.get('keywords', [])
            max_posts = parsed_command.get('max_posts', 100)
            
            # Build query
            query = select(SocialPost).where(
                SocialPost.user_id == user_id,
                SocialPost.status.in_([PostStatus.PUBLISHED.value, PostStatus.SCHEDULED.value])
            )
            
            if platforms:
                platform_values = [p.value for p in platforms]
                query = query.where(SocialPost.platform.in_(platform_values))
            
            if date_range.get('start'):
                start_date = datetime.fromisoformat(date_range['start'])
                query = query.where(SocialPost.created_at >= start_date)
            
            if date_range.get('end'):
                end_date = datetime.fromisoformat(date_range['end'])
                query = query.where(SocialPost.created_at <= end_date)
            
            # Execute query
            result = await db.execute(query.limit(max_posts))
            posts = result.scalars().all()
            
            # Delete posts
            deleted_count = 0
            for post in posts:
                # Check content keywords if provided
                if content_keywords and not any(kw in post.content for kw in content_keywords):
                    continue
                
                try:
                    await self._delete_post(db, post)
                    deleted_count += 1
                except Exception as e:
                    logger.error(f"Failed to delete post {post.id}: {str(e)}")
            
            return {
                'success': True,
                'deleted_count': deleted_count,
                'total_matched': len(posts),
                'message': f"Deleted {deleted_count} posts matching your criteria"
            }
            
        except Exception as e:
            logger.error(f"Bulk delete failed: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }

    async def _delete_post(self, db: AsyncSession, post: SocialPost) -> None:
        """Delete a single post from platform and database"""
        try:
            # Get platform credentials
            account = await self._get_platform_account(
                db, post.user_id, PlatformType(post.platform))
            if not account:
                raise ValueError("Account not connected")
            
            # Decrypt credentials
            credentials = self._decrypt_credentials(account.encrypted_credentials)
            
            # Platform-specific deletion
            if post.platform == PlatformType.INSTAGRAM.value:
                await self._delete_instagram_post(post.platform_post_id, credentials)
            elif post.platform == PlatformType.TIKTOK.value:
                await self._delete_tiktok_post(post.platform_post_id, credentials)
            # Implement for other platforms...
            
            # Update database
            post.status = PostStatus.DELETED.value
            post.deleted_at = datetime.utcnow()
            await db.commit()
            
        except Exception as e:
            logger.error(f"Delete failed for post {post.id}: {str(e)}")
            post.status = PostStatus.FAILED.value
            post.last_error = str(e)
            await db.commit()
            raise

    async def _delete_instagram_post(self, post_id: str, credentials: Dict) -> None:
        """Delete Instagram post"""
        access_token = credentials['access_token']
        async with self.session.delete(
            f"https://graph.facebook.com/v18.0/{post_id}",
            params={'access_token': access_token}
        ) as response:
            if response.status != 200:
                result = await response.json()
                raise Exception(f"Instagram delete failed: {result}")

    async def _delete_tiktok_post(self, post_id: str, credentials: Dict) -> None:
        """Delete TikTok post"""
        access_token = credentials['access_token']
        headers = {
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json'
        }
        async with self.session.delete(
            f"https://open.tiktokapis.com/v2/post/publish/video/{post_id}/",
            headers=headers
        ) as response:
            if response.status != 200:
                result = await response.json()
                raise Exception(f"TikTok delete failed: {result}")

    async def get_post_analytics(
        self,
        db: AsyncSession,
        user_id: str,
        post_id: str
    ) -> Dict[str, Any]:
        """Get analytics for a specific post (works offline from cache)"""
        cache_key = f"post_analytics:{post_id}"
        cached = await self.redis_client.get(cache_key)
        if cached:
            return json.loads(cached)
        
        # Fetch post
        result = await db.execute(
            select(SocialPost).where(
                SocialPost.id == post_id,
                SocialPost.user_id == user_id
            )
        )
        post = result.scalar_one_or_none()
        if not post:
            return {}
        
        # Placeholder: In real app, fetch from platform API
        analytics = {
            'impressions': 1000,
            'engagement': 150,
            'clicks': 50,
            'shares': 30,
            'comments': 20,
            'reach': 5000,
            'engagement_rate': 15.0,
            'demographics': {
                'age': {'18-24': 40, '25-34': 35, '35-44': 15, '45+': 10},
                'gender': {'male': 45, 'female': 55},
                'location': {'US': 60, 'UK': 15, 'CA': 10, 'Other': 15}
            }
        }
        
        # Cache for 1 hour
        await self.redis_client.set(cache_key, json.dumps(analytics), ex=3600)
        return analytics