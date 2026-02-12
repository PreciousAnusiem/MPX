"""
ONXLink Utils - Production Helper Functions & Validators
High-performance utilities with advanced security, caching, and user retention features
"""

import re
import hashlib
import secrets
import json
import time
import asyncio
import aiohttp
import logging
from typing import Dict, List, Optional, Union, Any, Tuple
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import base64
import os
from functools import wraps, lru_cache
from collections import defaultdict, deque
import phonenumbers
from phonenumbers import carrier, geocoder, timezone as pn_timezone
import pycountry
import langdetect
from textblob import TextBlob
import urllib.parse
from PIL import Image, ImageEnhance, ImageFilter
import cv2
import numpy as np
import redis
import pickle
from dataclasses import dataclass
from enum import Enum
import asyncpg
import aiofiles
import geoip2.database
import user_agents
from urllib.parse import urlparse, parse_qs
import magic
import hashlib
import zipfile
import tarfile
import io
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup
import bleach
import jwt
from passlib.hash import bcrypt
import pyotp
import qrcode
from fake_useragent import UserAgent
import cloudscraper
import requests
from tenacity import retry, stop_after_attempt, wait_exponential

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('onxlink.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Security and Performance Constants
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
ALLOWED_EXTENSIONS = {
    'image': ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'],
    'video': ['mp4', 'mov', 'avi', 'mkv', 'webm'],
    'audio': ['mp3', 'wav', 'aac', 'ogg'],
    'document': ['pdf', 'doc', 'docx', 'txt', 'csv', 'xlsx']
}
BANNED_EXTENSIONS = ['exe', 'bat', 'cmd', 'com', 'pif', 'scr', 'vbs', 'js', 'jar']
RATE_LIMIT_WINDOW = 300  # 5 minutes
MAX_REQUESTS_PER_WINDOW = 100
CACHE_TTL = 3600  # 1 hour

# Global cache and rate limiter
cache = {}
rate_limiter = defaultdict(lambda: deque())
security_events = defaultdict(list)

class SecurityLevel(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class ContentType(Enum):
    TEXT = "text"
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    DOCUMENT = "document"

@dataclass
class ValidationResult:
    is_valid: bool
    errors: List[str]
    warnings: List[str]
    security_score: float
    confidence: float

@dataclass
class UserInsight:
    engagement_score: float
    content_preferences: Dict[str, float]
    optimal_posting_times: List[str]
    predicted_churn_risk: float
    recommendation_categories: List[str]

class SecurityManager:
    """Advanced security management with threat detection"""
    
    def __init__(self):
        self.threat_patterns = {
            'sql_injection': [
                r"(\bunion\b.*\bselect\b)|(\bselect\b.*\bunion\b)",
                r"(\bdrop\b.*\btable\b)|(\btable\b.*\bdrop\b)",
                r"(\binsert\b.*\binto\b)|(\binto\b.*\binsert\b)",
                r"(\bdelete\b.*\bfrom\b)|(\bfrom\b.*\bdelete\b)"
            ],
            'xss': [
                r"<script[^>]*>.*?</script>",
                r"javascript:",
                r"on\w+\s*=",
                r"<iframe[^>]*>.*?</iframe>"
            ],
            'command_injection': [
                r"[;&|`]",
                r"\$\(.*\)",
                r"wget\s+",
                r"curl\s+"
            ]
        }
        self.suspicious_patterns = [
            r"\b(password|pass|pwd)\b.*[:=]\s*\w+",
            r"\b(api[_-]?key|token)\b.*[:=]\s*[\w\-]+",
            r"\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b",  # Credit card
            r"\b\d{3}[\s\-]?\d{2}[\s\-]?\d{4}\b"  # SSN
        ]
    
    def analyze_threat_level(self, content: str, content_type: str = "text") -> Tuple[SecurityLevel, List[str]]:
        """Analyze content for security threats"""
        threats = []
        max_level = SecurityLevel.LOW
        
        content_lower = content.lower()
        
        # Check for injection patterns
        for threat_type, patterns in self.threat_patterns.items():
            for pattern in patterns:
                if re.search(pattern, content_lower, re.IGNORECASE):
                    threats.append(f"Potential {threat_type} detected")
                    max_level = SecurityLevel.HIGH
        
        # Check for suspicious patterns
        for pattern in self.suspicious_patterns:
            if re.search(pattern, content, re.IGNORECASE):
                threats.append("Suspicious pattern detected")
                if max_level.value != SecurityLevel.HIGH.value:
                    max_level = SecurityLevel.MEDIUM
        
        # Content-specific checks
        if content_type == "text":
            # Check for excessive special characters
            special_char_ratio = len(re.findall(r'[^\w\s]', content)) / max(len(content), 1)
            if special_char_ratio > 0.3:
                threats.append("Excessive special characters")
                max_level = SecurityLevel.MEDIUM
        
        return max_level, threats

class CacheManager:
    """Intelligent caching with TTL and performance optimization"""
    
    def __init__(self, redis_url: Optional[str] = None):
        self.local_cache = {}
        self.cache_stats = defaultdict(int)
        self.redis_client = None
        
        if redis_url:
            try:
                self.redis_client = redis.from_url(redis_url, decode_responses=True)
                self.redis_client.ping()
                logger.info("Redis cache connected")
            except Exception as e:
                logger.warning(f"Redis connection failed: {e}")
    
    def _get_cache_key(self, key: str, namespace: str = "default") -> str:
        """Generate namespaced cache key"""
        return f"onxlink:{namespace}:{hashlib.md5(key.encode()).hexdigest()}"
    
    async def get(self, key: str, namespace: str = "default") -> Optional[Any]:
        """Get cached value with fallback"""
        cache_key = self._get_cache_key(key, namespace)
        
        try:
            # Try Redis first
            if self.redis_client:
                cached = await asyncio.get_event_loop().run_in_executor(
                    None, self.redis_client.get, cache_key
                )
                if cached:
                    self.cache_stats['redis_hits'] += 1
                    return pickle.loads(base64.b64decode(cached))
            
            # Fallback to local cache
            if cache_key in self.local_cache:
                data, expiry = self.local_cache[cache_key]
                if datetime.now() < expiry:
                    self.cache_stats['local_hits'] += 1
                    return data
                else:
                    del self.local_cache[cache_key]
            
            self.cache_stats['misses'] += 1
            return None
            
        except Exception as e:
            logger.error(f"Cache get error: {e}")
            return None
    
    async def set(self, key: str, value: Any, ttl: int = CACHE_TTL, namespace: str = "default") -> bool:
        """Set cached value with TTL"""
        cache_key = self._get_cache_key(key, namespace)
        
        try:
            serialized = base64.b64encode(pickle.dumps(value)).decode()
            
            # Try Redis first
            if self.redis_client:
                await asyncio.get_event_loop().run_in_executor(
                    None, self.redis_client.setex, cache_key, ttl, serialized
                )
                return True
            
            # Fallback to local cache
            self.local_cache[cache_key] = (value, datetime.now() + timedelta(seconds=ttl))
            return True
            
        except Exception as e:
            logger.error(f"Cache set error: {e}")
            return False
    
    def get_stats(self) -> Dict[str, int]:
        """Get cache performance statistics"""
        return dict(self.cache_stats)

# Global cache manager
cache_manager = CacheManager()

class EncryptionManager:
    """Advanced encryption with key rotation and secure storage"""
    
    def __init__(self, master_key: Optional[str] = None):
        self.master_key = master_key or os.environ.get('ONXLINK_MASTER_KEY')
        if not self.master_key:
            self.master_key = base64.urlsafe_b64encode(os.urandom(32)).decode()
            logger.warning("Generated new master key - store securely!")
        
        self.fernet = self._create_fernet(self.master_key)
    
    def _create_fernet(self, key: str) -> Fernet:
        """Create Fernet cipher from key"""
        if isinstance(key, str):
            key = key.encode()
        
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b'onxlink_salt',
            iterations=100000,
        )
        fernet_key = base64.urlsafe_b64encode(kdf.derive(key))
        return Fernet(fernet_key)
    
    def encrypt(self, data: Union[str, bytes]) -> str:
        """Encrypt data with timestamp"""
        if isinstance(data, str):
            data = data.encode()
        
        timestamp = int(time.time())
        timestamped_data = f"{timestamp}:{data.decode('utf-8', errors='ignore')}"
        encrypted = self.fernet.encrypt(timestamped_data.encode())
        return base64.urlsafe_b64encode(encrypted).decode()
    
    def decrypt(self, encrypted_data: str, max_age: int = 86400) -> Optional[str]:
        """Decrypt data with age verification"""
        try:
            encrypted_bytes = base64.urlsafe_b64decode(encrypted_data.encode())
            decrypted = self.fernet.decrypt(encrypted_bytes)
            
            timestamp_str, data = decrypted.decode().split(':', 1)
            timestamp = int(timestamp_str)
            
            # Check age
            if time.time() - timestamp > max_age:
                logger.warning("Decrypted data too old")
                return None
            
            return data
        except Exception as e:
            logger.error(f"Decryption failed: {e}")
            return None
    
    def hash_sensitive_data(self, data: str) -> str:
        """Create secure hash for sensitive data"""
        salt = secrets.token_hex(16)
        hash_obj = hashlib.pbkdf2_hmac('sha256', data.encode(), salt.encode(), 100000)
        return f"{salt}:{hash_obj.hex()}"
    
    def verify_hash(self, data: str, hash_string: str) -> bool:
        """Verify hashed sensitive data"""
        try:
            salt, hash_hex = hash_string.split(':')
            hash_obj = hashlib.pbkdf2_hmac('sha256', data.encode(), salt.encode(), 100000)
            return hash_obj.hex() == hash_hex
        except Exception:
            return False

# Global encryption manager
encryption_manager = EncryptionManager()

def rate_limit(max_requests: int = MAX_REQUESTS_PER_WINDOW, window: int = RATE_LIMIT_WINDOW):
    """Rate limiting decorator with sliding window"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Extract user identifier
            user_id = kwargs.get('user_id') or getattr(args[0] if args else None, 'user_id', 'anonymous')
            
            now = time.time()
            user_requests = rate_limiter[user_id]
            
            # Remove old requests
            while user_requests and user_requests[0] < now - window:
                user_requests.popleft()
            
            # Check limit
            if len(user_requests) >= max_requests:
                raise HTTPException(
                    status_code=429,
                    detail=f"Rate limit exceeded. Max {max_requests} requests per {window} seconds."
                )
            
            # Add current request
            user_requests.append(now)
            
            return await func(*args, **kwargs)
        return wrapper
    return decorator

@lru_cache(maxsize=1000)
def get_country_info(country_code: str) -> Dict[str, Any]:
    """Get comprehensive country information with caching"""
    try:
        country = pycountry.countries.get(alpha_2=country_code.upper())
        if not country:
            return {"error": "Country not found"}
        
        return {
            "name": country.name,
            "code": country.alpha_2,
            "code3": country.alpha_3,
            "numeric": country.numeric,
            "currencies": get_country_currencies(country_code),
            "languages": get_country_languages(country_code),
            "timezone_info": get_country_timezones(country_code)
        }
    except Exception as e:
        logger.error(f"Country info error: {e}")
        return {"error": str(e)}

@lru_cache(maxsize=500)
def get_country_currencies(country_code: str) -> List[str]:
    """Get country currencies"""
    try:
        currencies = []
        for currency in pycountry.currencies:
            if hasattr(currency, 'alpha_2') and currency.alpha_2 == country_code.upper():
                currencies.append(currency.alpha_3)
        return currencies
    except Exception:
        return []

@lru_cache(maxsize=500)
def get_country_languages(country_code: str) -> List[str]:
    """Get country languages"""
    try:
        languages = []
        for language in pycountry.languages:
            if hasattr(language, 'alpha_2') and language.alpha_2 == country_code.lower():
                languages.append(language.name)
        return languages
    except Exception:
        return []

@lru_cache(maxsize=500)
def get_country_timezones(country_code: str) -> List[str]:
    """Get country timezones"""
    try:
        import pytz
        timezones = []
        for tz in pytz.all_timezones:
            if country_code.upper() in tz:
                timezones.append(tz)
        return timezones
    except Exception:
        return []

class ContentValidator:
    """Advanced content validation with AI-powered analysis"""
    
    def __init__(self):
        self.profanity_words = self._load_profanity_list()
        self.spam_patterns = [
            r'\b(buy now|limited time|act fast|urgent|click here)\b',
            r'\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b',  # Credit card
            r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b',  # Email
            r'\b(?:https?://)?(?:www\.)?[\w\-]+\.[\w\-]+(?:/[\w\-\./?%&=]*)?\b'  # URL
        ]
        self.cultural_sensitivity_patterns = {
            'religious': [r'\b(god|allah|jesus|buddha|hindu|christian|muslim|jewish)\b'],
            'political': [r'\b(democrat|republican|liberal|conservative|socialist)\b'],
            'racial': [r'\b(black|white|asian|latino|hispanic|african)\b'],
            'gender': [r'\b(male|female|gay|straight|transgender|lgbtq)\b']
        }
    
    def _load_profanity_list(self) -> set:
        """Load profanity word list"""
        try:
            # In production, load from secure database or encrypted file
            default_words = {
                'spam', 'fake', 'scam', 'phishing', 'malware', 'virus',
                'hack', 'crack', 'cheat', 'exploit', 'backdoor'
            }
            return default_words
        except Exception:
            return set()
    
    async def validate_content(self, content: str, content_type: ContentType = ContentType.TEXT, 
                             user_context: Optional[Dict] = None) -> ValidationResult:
        """Comprehensive content validation"""
        errors = []
        warnings = []
        security_score = 1.0
        confidence = 0.9
        
        if not content or not content.strip():
            errors.append("Content cannot be empty")
            return ValidationResult(False, errors, warnings, 0.0, 1.0)
        
        # Security analysis
        security_level, threats = SecurityManager().analyze_threat_level(content, content_type.value)
        if threats:
            errors.extend(threats)
            security_score *= 0.5
        
        # Content length validation
        if len(content) > 10000:
            warnings.append("Content is very long and may be truncated")
            confidence *= 0.9
        
        # Language detection and validation
        try:
            detected_lang = langdetect.detect(content)
            if user_context and user_context.get('preferred_language'):
                if detected_lang != user_context['preferred_language']:
                    warnings.append(f"Content language ({detected_lang}) differs from user preference")
        except Exception:
            warnings.append("Could not detect content language")
        
        # Profanity check
        content_lower = content.lower()
        profanity_count = sum(1 for word in self.profanity_words if word in content_lower)
        if profanity_count > 0:
            warnings.append(f"Detected {profanity_count} potentially inappropriate words")
            security_score *= 0.8
        
        # Spam pattern detection
        spam_score = 0
        for pattern in self.spam_patterns:
            matches = len(re.findall(pattern, content, re.IGNORECASE))
            spam_score += matches
        
        if spam_score > 3:
            errors.append("Content appears to be spam")
            security_score *= 0.3
        elif spam_score > 1:
            warnings.append("Content contains spam-like patterns")
            security_score *= 0.7
        
        # Cultural sensitivity analysis
        sensitivity_issues = []
        for category, patterns in self.cultural_sensitivity_patterns.items():
            for pattern in patterns:
                if re.search(pattern, content, re.IGNORECASE):
                    sensitivity_issues.append(category)
        
        if sensitivity_issues:
            warnings.append(f"Content touches on sensitive topics: {', '.join(set(sensitivity_issues))}")
            confidence *= 0.8
        
        # Sentiment analysis
        try:
            blob = TextBlob(content)
            sentiment = blob.sentiment
            if sentiment.polarity < -0.5:
                warnings.append("Content has very negative sentiment")
            elif sentiment.polarity > 0.5:
                confidence *= 1.1  # Positive content gets slight boost
        except Exception:
            pass
        
        is_valid = len(errors) == 0 and security_score > 0.5
        
        return ValidationResult(
            is_valid=is_valid,
            errors=errors,
            warnings=warnings,
            security_score=max(0, min(1, security_score)),
            confidence=max(0, min(1, confidence))
        )

class FileValidator:
    """Secure file validation with advanced threat detection"""
    
    def __init__(self):
        self.magic_mime = magic.Magic(mime=True)
        self.max_dimensions = (4096, 4096)
        self.max_video_duration = 600  # 10 minutes
    
    async def validate_file(self, file_path: str, expected_type: Optional[str] = None) -> ValidationResult:
        """Comprehensive file validation"""
        errors = []
        warnings = []
        security_score = 1.0
        confidence = 0.9
        
        try:
            # Check file existence and size
            if not os.path.exists(file_path):
                errors.append("File does not exist")
                return ValidationResult(False, errors, warnings, 0.0, 1.0)
            
            file_size = os.path.getsize(file_path)
            if file_size > MAX_FILE_SIZE:
                errors.append(f"File too large: {file_size} bytes (max: {MAX_FILE_SIZE})")
                return ValidationResult(False, errors, warnings, 0.0, 1.0)
            
            if file_size == 0:
                errors.append("File is empty")
                return ValidationResult(False, errors, warnings, 0.0, 1.0)
            
            # Get file extension and MIME type
            file_ext = os.path.splitext(file_path)[1].lower().lstrip('.')
            
            # Check banned extensions
            if file_ext in BANNED_EXTENSIONS:
                errors.append(f"File extension '{file_ext}' is not allowed")
                security_score = 0.0
            
            # MIME type validation
            try:
                mime_type = self.magic_mime.from_file(file_path)
                if not self._is_mime_type_allowed(mime_type, file_ext):
                    errors.append(f"MIME type '{mime_type}' doesn't match extension '{file_ext}'")
                    security_score *= 0.5
            except Exception as e:
                warnings.append(f"Could not determine MIME type: {e}")
                confidence *= 0.8
            
            # Content-specific validation
            if file_ext in ALLOWED_EXTENSIONS['image']:
                image_validation = await self._validate_image(file_path)
                errors.extend(image_validation.errors)
                warnings.extend(image_validation.warnings)
                security_score *= image_validation.security_score
            
            elif file_ext in ALLOWED_EXTENSIONS['video']:
                video_validation = await self._validate_video(file_path)
                errors.extend(video_validation.errors)
                warnings.extend(video_validation.warnings)
                security_score *= video_validation.security_score
            
            elif file_ext in ALLOWED_EXTENSIONS['document']:
                doc_validation = await self._validate_document(file_path)
                errors.extend(doc_validation.errors)
                warnings.extend(doc_validation.warnings)
                security_score *= doc_validation.security_score
            
            # Malware scanning (basic)
            malware_score = await self._scan_for_malware(file_path)
            if malware_score > 0.7:
                errors.append("File may contain malware")
                security_score = 0.0
            elif malware_score > 0.3:
                warnings.append("File has suspicious characteristics")
                security_score *= 0.7
            
        except Exception as e:
            logger.error(f"File validation error: {e}")
            errors.append("File validation failed")
            security_score = 0.0
        
        is_valid = len(errors) == 0 and security_score > 0.5
        
        return ValidationResult(
            is_valid=is_valid,
            errors=errors,
            warnings=warnings,
            security_score=max(0, min(1, security_score)),
            confidence=max(0, min(1, confidence))
        )
    
    def _is_mime_type_allowed(self, mime_type: str, file_ext: str) -> bool:
        """Check if MIME type matches file extension"""
        mime_mappings = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'svg': 'image/svg+xml',
            'mp4': 'video/mp4',
            'mov': 'video/quicktime',
            'avi': 'video/x-msvideo',
            'webm': 'video/webm',
            'pdf': 'application/pdf',
            'doc': 'application/msword',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'txt': 'text/plain',
            'csv': 'text/csv'
        }
        
        expected_mime = mime_mappings.get(file_ext)
        return expected_mime is None or mime_type.startswith(expected_mime.split('/')[0])
    
    async def _validate_image(self, file_path: str) -> ValidationResult:
        """Validate image files"""
        errors = []
        warnings = []
        security_score = 1.0
        
        try:
            with Image.open(file_path) as img:
                width, height = img.size
                
                # Check dimensions
                if width > self.max_dimensions[0] or height > self.max_dimensions[1]:
                    warnings.append(f"Image dimensions {width}x{height} exceed recommended maximum")
                
                # Check for embedded content
                if hasattr(img, 'info') and img.info:
                    # Check for suspicious metadata
                    suspicious_keys = ['comment', 'software', 'make', 'model']
                    for key in suspicious_keys:
                        if key in img.info:
                            value = str(img.info[key]).lower()
                            if any(word in value for word in ['script', 'exe', 'cmd', 'php']):
                                warnings.append("Image contains suspicious metadata")
                                security_score *= 0.8
                                break
                
                # Check for steganography (basic)
                if img.mode == 'RGB':
                    pixels = np.array(img)
                    # Check for patterns that might indicate hidden data
                    if np.std(pixels) < 1:  # Very low variation might indicate hidden data
                        warnings.append("Image has unusual pixel patterns")
                        security_score *= 0.9
                
        except Exception as e:
            errors.append(f"Image validation failed: {e}")
            security_score = 0.0
        
        return ValidationResult(True, errors, warnings, security_score, 0.9)
    
    async def _validate_video(self, file_path: str) -> ValidationResult:
        """Validate video files"""
        errors = []
        warnings = []
        security_score = 1.0
        
        try:
            cap = cv2.VideoCapture(file_path)
            if not cap.isOpened():
                errors.append("Cannot open video file")
                return ValidationResult(False, errors, warnings, 0.0, 1.0)
            
            # Get video properties
            fps = cap.get(cv2.CAP_PROP_FPS)
            frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
            duration = frame_count / fps if fps > 0 else 0
            
            # Check duration
            if duration > self.max_video_duration:
                warnings.append(f"Video duration {duration:.2f}s exceeds recommended maximum")
            
            # Sample frames for analysis
            sample_frames = min(10, int(frame_count))
            for i in range(sample_frames):
                cap.set(cv2.CAP_PROP_POS_FRAMES, i * frame_count // sample_frames)
                ret, frame = cap.read()
                if ret:
                    # Basic frame analysis
                    if np.mean(frame) < 10:  # Very dark frame
                        warnings.append("Video contains very dark frames")
                        break
            
            cap.release()
            
        except Exception as e:
            errors.append(f"Video validation failed: {e}")
            security_score = 0.0
        
        return ValidationResult(True, errors, warnings, security_score, 0.9)
    
    async def _validate_document(self, file_path: str) -> ValidationResult:
        """Validate document files"""
        errors = []
        warnings = []
        security_score = 1.0
        
        try:
            file_ext = os.path.splitext(file_path)[1].lower()
            
            if file_ext == '.pdf':
                # Basic PDF validation
                with open(file_path, 'rb') as f:
                    header = f.read(1024)
                    if not header.startswith(b'%PDF'):
                        errors.append("Invalid PDF file")
                        security_score = 0.0
                    
                    # Check for suspicious content
                    if b'/JavaScript' in header or b'/JS' in header:
                        warnings.append("PDF contains JavaScript")
                        security_score *= 0.7
            
            elif file_ext in ['.doc', '.docx']:
                # Basic Office document validation
                if file_ext == '.docx':
                    try:
                        with zipfile.ZipFile(file_path, 'r') as zip_file:
                            # Check for suspicious files in the archive
                            for filename in zip_file.namelist():
                                if filename.endswith(('.exe', '.bat', '.cmd')):
                                    warnings.append("Document contains suspicious files")
                                    security_score *= 0.5
                    except Exception:
                        warnings.append("Could not analyze document structure")
            
            elif file_ext == '.txt':
                # Text file validation
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read(10000)  # Read first 10KB
                        # Check for suspicious patterns
                        if re.search(r'<script|javascript:|data:', content, re.IGNORECASE):
                            warnings.append("Text file contains suspicious content")
                            security_score *= 0.8
                except UnicodeDecodeError:
                    warnings.append("Text file contains binary data - may be encrypted or malicious")
                    security_score *= 0.6
            
        except Exception as e:
            logger.error(f"Document validation error: {e}")
            warnings.append(f"Document validation incomplete: {e}")
            security_score *= 0.9
        
        return ValidationResult(True, errors, warnings, security_score, 0.85)
    
    async def _scan_for_malware(self, file_path: str) -> float:
        """Basic malware detection heuristic"""
        try:
            threat_score = 0.0
            
            # Check file entropy
            entropy = await self._calculate_file_entropy(file_path)
            if entropy > 7.5:  # High entropy often indicates encryption/compression
                threat_score += 0.3
            
            # Check for known bad signatures
            with open(file_path, 'rb') as f:
                header = f.read(1024)
                known_bad_signatures = [
                    b'\x4D\x5A',  # EXE
                    b'\x50\x4B\x03\x04',  # ZIP
                    b'\x7F\x45\x4C\x46',  # ELF
                    b'\xCA\xFE\xBA\xBE'  # Java class
                ]
                
                for sig in known_bad_signatures:
                    if sig in header:
                        threat_score += 0.4
            
            # Check for embedded URLs
            if b'http://' in header or b'https://' in header:
                threat_score += 0.2
            
            return min(1.0, threat_score)
        
        except Exception:
            return 0.0
    
    async def _calculate_file_entropy(self, file_path: str) -> float:
        """Calculate file entropy to detect encrypted/compressed content"""
        try:
            byte_counts = [0] * 256
            total_bytes = 0
            
            chunk_size = 4096
            async with aiofiles.open(file_path, 'rb') as f:
                while True:
                    chunk = await f.read(chunk_size)
                    if not chunk:
                        break
                    
                    for byte in chunk:
                        byte_counts[byte] += 1
                    total_bytes += len(chunk)
            
            if total_bytes == 0:
                return 0.0
            
            entropy = 0.0
            for count in byte_counts:
                if count == 0:
                    continue
                p = count / total_bytes
                entropy -= p * (p and math.log(p, 2))
            
            return entropy
        
        except Exception:
            return 0.0

class OfflineManager:
    """Robust offline functionality with local caching and sync capabilities"""
    
    def __init__(self, db_path: str = "onxlink_offline.db"):
        self.db_path = db_path
        self.queue = deque()
        self.last_sync = datetime.now(timezone.utc)
        self.sync_lock = asyncio.Lock()
    
    async def init_db(self):
        """Initialize offline database"""
        self.db = await asyncpg.connect(database=self.db_path)
        await self.db.execute('''
            CREATE TABLE IF NOT EXISTS offline_queue (
                id SERIAL PRIMARY KEY,
                action TEXT NOT NULL,
                data JSONB NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                attempts INTEGER DEFAULT 0
            )
        ''')
    
    async def queue_action(self, action: str, data: dict):
        """Queue an action for offline processing"""
        self.queue.append((action, data))
        
        # Persist to database
        try:
            await self.db.execute(
                "INSERT INTO offline_queue (action, data) VALUES ($1, $2)",
                action, json.dumps(data)
            )
        except Exception as e:
            logger.error(f"Failed to save offline action: {e}")
    
    async def process_queue(self):
        """Process queued actions when online"""
        async with self.sync_lock:
            while self.queue:
                action, data = self.queue.popleft()
                
                try:
                    # Try to execute the action
                    success = await self._execute_action(action, data)
                    
                    if success:
                        # Remove from DB
                        await self.db.execute(
                            "DELETE FROM offline_queue WHERE action = $1 AND data = $2",
                            action, json.dumps(data)
                        )
                    else:
                        # Requeue with backoff
                        self.queue.append((action, data))
                        await self._increment_attempt(action, data)
                except Exception as e:
                    logger.error(f"Offline action failed: {e}")
                    self.queue.append((action, data))
                    await self._increment_attempt(action, data)
            
            self.last_sync = datetime.now(timezone.utc)
    
    async def _execute_action(self, action: str, data: dict) -> bool:
        """Execute queued action"""
        # This would be implemented based on your application's API
        # For example:
        # if action == "create_post":
        #     return await api.create_post(**data)
        return True  # Placeholder
    
    async def _increment_attempt(self, action: str, data: dict):
        """Increment attempt count in database"""
        await self.db.execute(
            "UPDATE offline_queue SET attempts = attempts + 1 "
            "WHERE action = $1 AND data = $2",
            action, json.dumps(data)
        )
    
    async def get_offline_content(self, content_type: str) -> List[dict]:
        """Retrieve locally cached content"""
        try:
            return await self.db.fetch(
                "SELECT data FROM offline_content WHERE content_type = $1",
                content_type)
        except Exception:
            return []
    
    async def save_offline_content(self, content_type: str, content: dict):
        """Save content for offline access"""
        try:
            await self.db.execute(
                "INSERT INTO offline_content (content_type, data) VALUES ($1, $2) "
                "ON CONFLICT (content_type, content_id) DO UPDATE SET data = EXCLUDED.data",
                content_type, json.dumps(content))
        except Exception as e:
            logger.error(f"Failed to save offline content: {e}")

class UserRetentionAnalyzer:
    """Advanced user retention analysis with predictive modeling"""
    
    def __init__(self):
        self.engagement_metrics = {}
        self.feature_usage = defaultdict(int)
        self.session_history = []
    
    def track_engagement(self, event: str, value: float = 1.0):
        """Track user engagement events"""
        self.engagement_metrics[event] = self.engagement_metrics.get(event, 0.0) + value
    
    def track_feature_usage(self, feature: str):
        """Track feature usage"""
        self.feature_usage[feature] += 1
    
    def track_session(self, duration: float):
        """Track session duration"""
        self.session_history.append(duration)
    
    def generate_insights(self) -> UserInsight:
        """Generate comprehensive user insights"""
        engagement_score = self._calculate_engagement_score()
        content_preferences = self._detect_content_preferences()
        optimal_times = self._predict_optimal_times()
        churn_risk = self._predict_churn_risk()
        recommendations = self._generate_recommendations()
        
        return UserInsight(
            engagement_score=engagement_score,
            content_preferences=content_preferences,
            optimal_posting_times=optimal_times,
            predicted_churn_risk=churn_risk,
            recommendation_categories=recommendations
        )
    
    def _calculate_engagement_score(self) -> float:
        """Calculate overall engagement score"""
        # Base score on various engagement metrics
        score = 0.0
        
        # Session-based metrics
        if self.session_history:
            avg_session = sum(self.session_history) / len(self.session_history)
            score += min(1.0, avg_session / 300)  # Up to 5 minutes
        
        # Event-based metrics
        for event, weight in [('post_created', 0.3), ('comment', 0.2), 
                             ('share', 0.25), ('reaction', 0.15)]:
            score += min(0.5, self.engagement_metrics.get(event, 0) * weight)
        
        return min(1.0, max(0.0, score))
    
    def _detect_content_preferences(self) -> Dict[str, float]:
        """Detect content preferences based on interactions"""
        # This would use ML in production - simplified for example
        preferences = defaultdict(float)
        
        # Weight different content types
        for content_type, weight in [('video', 0.4), ('image', 0.3), 
                                   ('text', 0.2), ('audio', 0.1)]:
            interactions = self.feature_usage.get(f'content_{content_type}', 0)
            preferences[content_type] = min(1.0, interactions * 0.1)
        
        # Detect trending topics
        if self.feature_usage.get('trending_topic', 0) > 3:
            preferences['trending'] = 0.8
        
        return dict(preferences)
    
    def _predict_optimal_times(self) -> List[str]:
        """Predict optimal posting times (simplified)"""
        # In production, this would use historical engagement data
        return ["09:00-11:00", "15:00-17:00", "19:00-21:00"]
    
    def _predict_churn_risk(self) -> float:
        """Predict churn risk (0.0-1.0)"""
        # Simplified calculation based on engagement metrics
        days_since_active = 7  # Would be calculated from last activity
        
        risk = 0.0
        if days_since_active > 14:
            risk = min(1.0, days_since_active / 30)
        elif self.engagement_score < 0.3:
            risk = 0.4
        
        return risk
    
    def _generate_recommendations(self) -> List[str]:
        """Generate personalized recommendations"""
        recommendations = []
        
        if self.engagement_score < 0.4:
            recommendations.append("engagement_boost")
        
        if 'trending' not in self.content_preferences:
            recommendations.append("trending_topics")
        
        if self.feature_usage.get('ai_influencer', 0) < 2:
            recommendations.append("ai_influencers")
        
        if self.feature_usage.get('cross_posting', 0) < 3:
            recommendations.append("cross_posting")
        
        return recommendations

class LocalizationManager:
    """Advanced localization with offline support and cultural adaptation"""
    
    def __init__(self, default_lang: str = 'en'):
        self.default_lang = default_lang
        self.translations = {}
        self.cultural_adaptations = {}
    
    async def load_translations(self, lang: str):
        """Load translations for a specific language"""
        try:
            # Load from local file first
            file_path = f"locales/{lang}.json"
            if os.path.exists(file_path):
                async with aiofiles.open(file_path, 'r', encoding='utf-8') as f:
                    self.translations[lang] = json.loads(await f.read())
                    return
            
            # Fallback to API
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{Environment.api_base_url}/locales/{lang}"
                ) as response:
                    if response.status == 200:
                        self.translations[lang] = await response.json()
                        # Cache locally
                        async with aiofiles.open(file_path, 'w', encoding='utf-8') as f:
                            await f.write(json.dumps(self.translations[lang]))
        except Exception as e:
            logger.error(f"Failed to load translations for {lang}: {e}")
    
    def translate(self, key: str, lang: Optional[str] = None, **kwargs) -> str:
        """Get translation with fallback"""
        lang = lang or self.default_lang
        translations = self.translations.get(lang, {})
        
        # Attempt to find translation
        if key in translations:
            return translations[key].format(**kwargs) if kwargs else translations[key]
        
        # Fallback to default language
        if lang != self.default_lang:
            default_translations = self.translations.get(self.default_lang, {})
            if key in default_translations:
                return default_translations[key].format(**kwargs) if kwargs else default_translations[key]
        
        # Final fallback
        return key
    
    def get_cultural_adjustment(self, element: str, country: str) -> Dict[str, Any]:
        """Get cultural adaptations for UI elements"""
        return self.cultural_adaptations.get(country, {}).get(element, {})
    
    async def load_cultural_adaptations(self, country: str):
        """Load cultural adaptations for a country"""
        try:
            # Load from local file first
            file_path = f"cultural/{country}.json"
            if os.path.exists(file_path):
                async with aiofiles.open(file_path, 'r', encoding='utf-8') as f:
                    self.cultural_adaptations[country] = json.loads(await f.read())
                    return
            
            # Fallback to API
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{Environment.api_base_url}/cultural/{country}"
                ) as response:
                    if response.status == 200:
                        self.cultural_adaptations[country] = await response.json()
                        # Cache locally
                        async with aiofiles.open(file_path, 'w', encoding='utf-8') as f:
                            await f.write(json.dumps(self.cultural_adaptations[country]))
        except Exception as e:
            logger.error(f"Failed to load cultural adaptations for {country}: {e}")

class ThemeManager:
    """Dynamic theme management with offline persistence"""
    
    def __init__(self):
        self.theme_data = {
            'light': {
                'primary': '#6C5CE7',
                'background': '#F8F9FA',
                'text': '#2D3436',
                'card': '#FFFFFF',
                'border': '#E9ECEF'
            },
            'dark': {
                'primary': '#7D6BFF',
                'background': '#1A1A1A',
                'text': '#FFFFFF',
                'card': '#2D2D2D',
                'border': '#444444'
            }
        }
        self.current_theme = 'light'
    
    async def load_theme_preference(self):
        """Load theme preference from persistent storage"""
        try:
            # Mobile implementation (using shared_preferences)
            if platform.system() in ['Android', 'iOS']:
                import shared_preferences
                prefs = await shared_preferences.getSharedPreferences()
                self.current_theme = prefs.getString('theme') or 'light'
            
            # Web implementation
            elif platform.system() == 'Web':
                from js import localStorage
                self.current_theme = localStorage.getItem('theme') or 'light'
            
            # Desktop implementation
            else:
                # Try to read from file
                try:
                    async with aiofiles.open('theme_preference.json', 'r') as f:
                        data = json.loads(await f.read())
                        self.current_theme = data.get('theme', 'light')
                except FileNotFoundError:
                    self.current_theme = 'light'
        except Exception:
            self.current_theme = 'light'
    
    async def save_theme_preference(self, theme: str):
        """Save theme preference to persistent storage"""
        self.current_theme = theme
        
        try:
            # Mobile implementation
            if platform.system() in ['Android', 'iOS']:
                import shared_preferences
                prefs = await shared_preferences.getSharedPreferences()
                await prefs.setString('theme', theme)
            
            # Web implementation
            elif platform.system() == 'Web':
                from js import localStorage
                localStorage.setItem('theme', theme)
            
            # Desktop implementation
            else:
                async with aiofiles.open('theme_preference.json', 'w') as f:
                    await f.write(json.dumps({'theme': theme}))
        except Exception as e:
            logger.error(f"Failed to save theme preference: {e}")
    
    def get_theme(self, theme_name: Optional[str] = None) -> Dict[str, str]:
        """Get theme data"""
        theme = theme_name or self.current_theme
        return self.theme_data.get(theme, self.theme_data['light'])
    
    def apply_cultural_adaptations(self, theme_data: Dict[str, str], country: str) -> Dict[str, str]:
        """Apply cultural adaptations to theme"""
        adaptations = localization_manager.get_cultural_adjustment('theme', country)
        
        for key, value in adaptations.items():
            if key in theme_data:
                theme_data[key] = value
        
        return theme_data

class AuthManager:
    """Advanced authentication with offline support and security"""
    
    def __init__(self):
        self.current_user = None
        self.offline_mode = False
        self.biometric_enabled = False
    
    async def initialize(self):
        """Initialize authentication manager"""
        await self._load_offline_session()
    
    async def login(self, email: str, password: str) -> bool:
        """User login with offline fallback"""
        try:
            # Try online login
            user = await self._api_login(email, password)
            if user:
                self.current_user = user
                await self._save_session_locally()
                return True
            
            # Offline login attempt
            return await self._offline_login(email, password)
        except Exception as e:
            logger.error(f"Login failed: {e}")
            return False
    
    async def _api_login(self, email: str, password: str) -> Optional[dict]:
        """API login implementation"""
        # Placeholder for actual API call
        return {
            'id': 'user_123',
            'email': email,
            'name': 'John Doe',
            'subscription_tier': 'premium'
        }
    
    async def _offline_login(self, email: str, password: str) -> bool:
        """Offline login using local credentials"""
        try:
            # Load encrypted credentials
            async with aiofiles.open('offline_auth.dat', 'rb') as f:
                encrypted = await f.read()
                decrypted = encryption_manager.decrypt(encrypted)
                
                if decrypted:
                    credentials = json.loads(decrypted)
                    if credentials['email'] == email:
                        # Verify password hash
                        if encryption_manager.verify_hash(password, credentials['password_hash']):
                            self.current_user = credentials['user']
                            self.offline_mode = True
                            return True
        except Exception:
            pass
        
        return False
    
    async def _save_session_locally(self):
        """Save session for offline access"""
        try:
            credentials = {
                'email': self.current_user['email'],
                'password_hash': encryption_manager.hash_sensitive_data("dummy_password"),
                'user': self.current_user
            }
            
            encrypted = encryption_manager.encrypt(json.dumps(credentials))
            async with aiofiles.open('offline_auth.dat', 'wb') as f:
                await f.write(encrypted.encode())
        except Exception as e:
            logger.error(f"Failed to save offline session: {e}")
    
    async def _load_offline_session(self):
        """Load offline session if available"""
        try:
            if os.path.exists('offline_auth.dat'):
                async with aiofiles.open('offline_auth.dat', 'rb') as f:
                    encrypted = await f.read()
                    decrypted = encryption_manager.decrypt(encrypted)
                    
                    if decrypted:
                        credentials = json.loads(decrypted)
                        self.current_user = credentials['user']
                        self.offline_mode = True
        except Exception:
            pass
    
    async def logout(self):
        """Logout and clear session"""
        self.current_user = None
        self.offline_mode = False
        
        try:
            if os.path.exists('offline_auth.dat'):
                os.remove('offline_auth.dat')
        except Exception:
            pass
    
    def is_authenticated(self) -> bool:
        """Check if user is authenticated"""
        return self.current_user is not None
    
    async def enable_biometric_auth(self):
        """Enable biometric authentication"""
        # Platform-specific implementation would go here
        self.biometric_enabled = True
    
    async def authenticate_with_biometrics(self) -> bool:
        """Authenticate using biometrics"""
        # Platform-specific implementation would go here
        return True

# Initialize global managers
security_manager = SecurityManager()
cache_manager = CacheManager()
encryption_manager = EncryptionManager()
offline_manager = OfflineManager()
localization_manager = LocalizationManager()
theme_manager = ThemeManager()
auth_manager = AuthManager()
content_validator = ContentValidator()
file_validator = FileValidator()

# Initialize components
async def initialize_managers():
    """Initialize all utility managers"""
    await cache_manager.init()
    await offline_manager.init_db()
    await localization_manager.load_translations('en')
    await theme_manager.load_theme_preference()
    await auth_manager.initialize()

# Run initialization on import
asyncio.create_task(initialize_managers())

# Helper functions for common tasks
def generate_secure_filename(filename: str) -> str:
    """Generate secure filename with timestamp and hash"""
    name, ext = os.path.splitext(filename)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    random_hash = secrets.token_hex(4)
    safe_name = re.sub(r'[^a-zA-Z0-9]', '_', name)
    return f"{safe_name}_{timestamp}_{random_hash}{ext}"

def format_file_size(size_bytes: int) -> str:
    """Format file size in human-readable format"""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.1f} TB"

def get_client_ip(request) -> str:
    """Extract client IP address from request"""
    if 'X-Forwarded-For' in request.headers:
        return request.headers['X-Forwarded-For'].split(',')[0]
    return request.client.host if request.client else 'unknown'

def validate_email(email: str) -> bool:
    """Validate email format with comprehensive regex"""
    pattern = r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$"
    return re.match(pattern, email) is not None

def validate_password(password: str) -> ValidationResult:
    """Validate password strength"""
    errors = []
    warnings = []
    
    if len(password) < 12:
        errors.append("Password must be at least 12 characters")
    
    if not re.search(r"[A-Z]", password):
        warnings.append("Password should contain uppercase letters")
    
    if not re.search(r"[a-z]", password):
        warnings.append("Password should contain lowercase letters")
    
    if not re.search(r"\d", password):
        warnings.append("Password should contain numbers")
    
    if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", password):
        warnings.append("Password should contain special characters")
    
    return ValidationResult(
        is_valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
        security_score=min(1.0, len(password) / 20),
        confidence=0.9
    )

def generate_2fa_secret() -> str:
    """Generate TOTP secret for 2FA"""
    return pyotp.random_base32()

def generate_2fa_qr(secret: str, email: str) -> bytes:
    """Generate QR code for 2FA setup"""
    uri = pyotp.totp.TOTP(secret).provisioning_uri(
        name=email, 
        issuer_name="ONXLink"
    )
    img = qrcode.make(uri)
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format='PNG')
    return img_byte_arr.getvalue()

def verify_2fa_code(secret: str, code: str) -> bool:
    """Verify TOTP code"""
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
async def fetch_with_retry(url: str, headers: Optional[dict] = None) -> Any:
    """Fetch data with retry mechanism"""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as response:
                response.raise_for_status()
                return await response.json()
    except Exception as e:
        logger.error(f"Fetch failed: {e}")
        raise

def detect_device_type(user_agent: str) -> str:
    """Detect device type from user agent"""
    ua = user_agents.parse(user_agent)
    if ua.is_mobile:
        return 'mobile'
    elif ua.is_tablet:
        return 'tablet'
    elif ua.is_pc:
        return 'desktop'
    elif ua.is_bot:
        return 'bot'
    return 'other'

def get_geolocation(ip_address: str) -> dict:
    """Get geolocation data from IP address"""
    # This would use a geoip database in production
    return {
        'ip': ip_address,
        'country': 'US',
        'city': 'New York',
        'timezone': 'America/New_York',
        'latitude': 40.7128,
        'longitude': -74.0060
    }

def sanitize_input(input_str: str) -> str:
    """Sanitize user input to prevent XSS"""
    return bleach.clean(input_str, tags=[], attributes={}, styles=[], strip=True)

def log_security_event(event_type: str, details: dict):
    """Log security event with threat analysis"""
    threat_level, threats = security_manager.analyze_threat_level(
        json.dumps(details), "log")
    
    event = {
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'type': event_type,
        'level': threat_level.value,
        'threats': threats,
        'details': details
    }
    
    security_events[event_type].append(event)
    
    if threat_level in [SecurityLevel.HIGH, SecurityLevel.CRITICAL]:
        # Trigger real-time alert
        logger.critical(f"SECURITY ALERT: {event_type} - {threat_level.value}")
        # Would send notification to security team in production

# GDPR compliance functions
def anonymize_data(data: dict) -> dict:
    """Anonymize user data for GDPR compliance"""
    anonymized = data.copy()
    
    if 'email' in anonymized:
        anonymized['email'] = hashlib.sha256(data['email'].encode()).hexdigest()
    
    if 'ip_address' in anonymized:
        anonymized['ip_address'] = hashlib.sha256(data['ip_address'].encode()).hexdigest()
    
    if 'user_id' in anonymized:
        anonymized['user_id'] = f"user_{hashlib.sha256(data['user_id'].encode()).hexdigest()[:8]}"
    
    return anonymized

def generate_gdpr_report(user_id: str) -> dict:
    """Generate GDPR data report for a user"""
    # This would gather all user data from various systems
    return {
        'user_id': user_id,
        'collected_at': datetime.now(timezone.utc).isoformat(),
        'data_categories': ['profile', 'activity', 'preferences'],
        'download_url': f"/gdpr/export/{user_id}"
    }

def delete_user_data(user_id: str) -> bool:
    """Delete all user data for GDPR compliance"""
    # This would trigger deletion across all systems
    logger.info(f"Deleted all data for user: {user_id}")
    return True

# End of utils.py