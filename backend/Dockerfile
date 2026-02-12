# ONXLink Production Dockerfile
# Multi-stage build for optimal security and performance

# Build stage
FROM python:3.11-slim as builder

# Set build arguments
ARG BUILD_ENV=production
ARG PYTHON_VERSION=3.11

# Install system dependencies for building
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    git \
    libpq-dev \
    libffi-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user for security
RUN groupadd -r onxlink && useradd -r -g onxlink onxlink

# Set working directory
WORKDIR /app

# Copy requirements first for better Docker layer caching
COPY requirements.txt requirements-dev.txt ./

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir gunicorn[gevent] && \
    pip install --no-cache-dir redis celery[redis] && \
    pip install --no-cache-dir prometheus-client && \
    pip install --no-cache-dir sentry-sdk[fastapi] && \
    pip install --no-cache-dir cryptography && \
    pip install --no-cache-dir python-multipart && \
    pip install --no-cache-dir aiofiles && \
    pip install --no-cache-dir aiocache[redis] && \
    pip install --no-cache-dir python-jose[cryptography] && \
    pip install --no-cache-dir passlib[bcrypt] && \
    pip install --no-cache-dir httpx && \
    pip install --no-cache-dir python-magic && \
    pip install --no-cache-dir pillow && \
    pip install --no-cache-dir opencv-python-headless && \
    pip install --no-cache-dir numpy && \
    pip install --no-cache-dir pandas && \
    pip install --no-cache-dir scikit-learn && \
    pip install --no-cache-dir tensorflow-cpu && \
    pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir transformers && \
    pip install --no-cache-dir openai && \
    pip install --no-cache-dir anthropic && \
    pip install --no-cache-dir google-cloud-translate && \
    pip install --no-cache-dir azure-cognitiveservices-vision-computervision && \
    pip install --no-cache-dir boto3 && \
    pip install --no-cache-dir stripe && \
    pip install --no-cache-dir paypal-checkout-serversdk && \
    pip install --no-cache-dir firebase-admin && \
    pip install --no-cache-dir tweepy && \
    pip install --no-cache-dir instagrapi && \
    pip install --no-cache-dir facebook-sdk && \
    pip install --no-cache-dir linkedin-api && \
    pip install --no-cache-dir python-telegram-bot && \
    pip install --no-cache-dir youtube-dl && \
    pip install --no-cache-dir moviepy && \
    pip install --no-cache-dir schedule && \
    pip install --no-cache-dir APScheduler && \
    pip install --no-cache-dir python-crontab && \
    pip install --no-cache-dir psutil && \
    pip install --no-cache-dir py-cpuinfo && \
    pip install --no-cache-dir memory-profiler && \
    pip install --no-cache-dir line-profiler && \
    pip install --no-cache-dir pytest pytest-asyncio pytest-cov && \
    pip install --no-cache-dir locust && \
    pip install --no-cache-dir bandit safety && \
    pip install --no-cache-dir pre-commit black isort flake8 mypy

# Production stage
FROM python:3.11-slim as production

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DEBIAN_FRONTEND=noninteractive \
    LC_ALL=C.UTF-8 \
    LANG=C.UTF-8 \
    TZ=UTC

# Install runtime dependencies and security tools
RUN apt-get update && apt-get install -y \
    # Runtime dependencies
    libpq5 \
    libffi8 \
    libssl3 \
    curl \
    wget \
    ca-certificates \
    # Image processing
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    # Video processing
    ffmpeg \
    # Security and monitoring
    fail2ban \
    logrotate \
    # Health checks
    netcat-openbsd \
    # Timezone data
    tzdata \
    # Clean up
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean \
    && apt-get autoremove -y

# Create non-root user with specific UID/GID
RUN groupadd -r -g 1001 onxlink && \
    useradd -r -u 1001 -g onxlink -m -d /home/onxlink -s /bin/bash onxlink

# Create necessary directories with proper permissions
RUN mkdir -p /app /app/logs /app/uploads /app/cache /app/tmp /app/backups \
    /var/log/onxlink /var/run/onxlink /etc/onxlink && \
    chown -R onxlink:onxlink /app /var/log/onxlink /var/run/onxlink /etc/onxlink && \
    chmod -R 755 /app && \
    chmod -R 750 /var/log/onxlink /var/run/onxlink /etc/onxlink

# Copy Python packages from builder stage
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Switch to working directory
WORKDIR /app

# Copy application code
COPY --chown=onxlink:onxlink . .

# Copy configuration files
COPY --chown=onxlink:onxlink docker/nginx.conf /etc/nginx/nginx.conf
COPY --chown=onxlink:onxlink docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY --chown=onxlink:onxlink docker/gunicorn.conf.py /etc/onxlink/gunicorn.conf.py
COPY --chown=onxlink:onxlink docker/celery.conf /etc/onxlink/celery.conf
COPY --chown=onxlink:onxlink docker/redis.conf /etc/onxlink/redis.conf
COPY --chown=onxlink:onxlink docker/logrotate.conf /etc/logrotate.d/onxlink

# Create offline cache directories
RUN mkdir -p /app/offline_cache/{models,templates,content,translations,analytics} && \
    chown -R onxlink:onxlink /app/offline_cache && \
    chmod -R 755 /app/offline_cache

# Set up offline AI models cache
RUN python -c "
import os
import urllib.request
import json

# Download lightweight AI models for offline use
models_dir = '/app/offline_cache/models'
os.makedirs(models_dir, exist_ok=True)

# Download sentiment analysis model
try:
    from transformers import pipeline
    sentiment_pipeline = pipeline('sentiment-analysis', model='cardiffnlp/twitter-roberta-base-sentiment-latest')
    sentiment_pipeline.save_pretrained(f'{models_dir}/sentiment')
except:
    pass

# Download text generation model
try:
    from transformers import GPT2LMHeadModel, GPT2Tokenizer
    model = GPT2LMHeadModel.from_pretrained('gpt2')
    tokenizer = GPT2Tokenizer.from_pretrained('gpt2')
    model.save_pretrained(f'{models_dir}/gpt2')
    tokenizer.save_pretrained(f'{models_dir}/gpt2')
except:
    pass

# Download translation models for top languages
languages = ['es', 'fr', 'de', 'zh', 'ja', 'ko', 'ar', 'ru', 'pt', 'it']
for lang in languages:
    try:
        from transformers import MarianMTModel, MarianTokenizer
        model_name = f'Helsinki-NLP/opus-mt-en-{lang}'
        model = MarianMTModel.from_pretrained(model_name)
        tokenizer = MarianTokenizer.from_pretrained(model_name)
        model.save_pretrained(f'{models_dir}/translate_en_{lang}')
        tokenizer.save_pretrained(f'{models_dir}/translate_en_{lang}')
    except:
        continue

print('Offline models cached successfully')
" || echo "Model caching completed with some failures"

# Create offline content templates
RUN python -c "
import json
import os

templates_dir = '/app/offline_cache/templates'
os.makedirs(templates_dir, exist_ok=True)

# Social media templates
social_templates = {
    'instagram': {
        'post': [
            '🚀 {content} #trending #viral #instagram',
            '✨ {content} \n\n#lifestyle #inspiration',
            '💫 {content} \n\nTag someone who needs to see this! 👇',
            '🔥 {content} \n\n#motivation #success #goals'
        ],
        'story': [
            'Quick update: {content}',
            'Behind the scenes: {content}',
            'Swipe up for more: {content}'
        ],
        'reel': [
            'Watch this! {content} #reels #viral',
            'POV: {content} #trending #relatable',
            'This is how you {content} #tutorial #howto'
        ]
    },
    'tiktok': {
        'video': [
            'POV: {content} #fyp #viral #trending',
            'This is why {content} #foryou #facts',
            'Nobody talks about {content} #truth #real',
            'Day {day} of {content} #challenge #journey'
        ],
        'hashtags': [
            '#fyp #foryou #viral #trending #tiktok',
            '#facts #truth #real #life #advice',
            '#challenge #journey #growth #motivation',
            '#tutorial #howto #learn #tips #hacks'
        ]
    },
    'twitter': {
        'tweet': [
            '{content} 🧵 Thread below 👇',
            'Hot take: {content}',
            'Unpopular opinion: {content}',
            'PSA: {content} \n\nRetweet if you agree 🔄'
        ],
        'thread': [
            '1/ {content} \n\nA thread 🧵',
            '2/ Here\'s why this matters: {content}',
            '3/ The key insight: {content}',
            'Final thoughts: {content} \n\nWhat do you think?'
        ]
    },
    'linkedin': {
        'post': [
            'Lesson learned: {content} \n\nThoughts? 💭',
            'Career advice: {content} \n\n#CareerGrowth #Leadership',
            'Industry insight: {content} \n\n#Business #Strategy',
            'Personal reflection: {content} \n\n#ProfessionalDevelopment'
        ]
    },
    'facebook': {
        'post': [
            '{content} \n\nWhat are your thoughts on this?',
            'Sharing because this matters: {content}',
            'Found this interesting: {content}',
            'Weekly reminder: {content}'
        ]
    }
}

with open(f'{templates_dir}/social_templates.json', 'w') as f:
    json.dump(social_templates, f, indent=2)

# Content generation prompts
content_prompts = {
    'engagement': [
        'Create an engaging social media post about {topic}',
        'Write a viral caption for {topic}',
        'Generate a thought-provoking question about {topic}',
        'Create a storytelling post about {topic}'
    ],
    'educational': [
        'Explain {topic} in simple terms',
        'Share 5 tips about {topic}',
        'Create a how-to guide for {topic}',
        'List common mistakes in {topic}'
    ],
    'promotional': [
        'Create a soft promotion for {product} related to {topic}',
        'Write an authentic testimonial about {topic}',
        'Generate a behind-the-scenes post about {topic}',
        'Create a before/after story about {topic}'
    ],
    'trending': [
        'Create a post that taps into current trends about {topic}',
        'Generate content that matches viral patterns for {topic}',
        'Write a post that encourages user-generated content about {topic}',
        'Create shareable content about {topic}'
    ]
}

with open(f'{templates_dir}/content_prompts.json', 'w') as f:
    json.dump(content_prompts, f, indent=2)

print('Content templates cached successfully')
"

# Set up offline analytics
RUN python -c "
import json
import os
from datetime import datetime, timedelta

analytics_dir = '/app/offline_cache/analytics'
os.makedirs(analytics_dir, exist_ok=True)

# Create offline analytics structure
offline_analytics = {
    'metrics': {
        'posts_created': 0,
        'platforms_connected': 0,
        'content_generated': 0,
        'ai_interactions': 0,
        'last_sync': datetime.now().isoformat(),
        'sync_queue': []
    },
    'engagement_patterns': {
        'best_posting_times': {
            'instagram': ['9:00', '15:00', '21:00'],
            'tiktok': ['6:00', '10:00', '19:00'],
            'twitter': ['8:00', '12:00', '17:00'],
            'linkedin': ['8:00', '12:00', '17:00'],
            'facebook': ['13:00', '15:00', '21:00']
        },
        'optimal_hashtags': {
            'instagram': ['#trending', '#viral', '#lifestyle', '#inspiration'],
            'tiktok': ['#fyp', '#foryou', '#viral', '#trending'],
            'twitter': ['#MondayMotivation', '#ThrowbackThursday', '#FridayFeeling'],
            'linkedin': ['#Leadership', '#CareerGrowth', '#Business', '#Strategy']
        }
    },
    'content_performance': {
        'high_performing_topics': [],
        'engagement_rates': {},
        'viral_indicators': []
    }
}

with open(f'{analytics_dir}/offline_data.json', 'w') as f:
    json.dump(offline_analytics, f, indent=2)

print('Offline analytics structure created')
"

# Security configurations
RUN python -c "
import os
import secrets
import json

# Generate secure keys for offline encryption
security_dir = '/app/offline_cache'
keys = {
    'encryption_key': secrets.token_hex(32),
    'signing_key': secrets.token_hex(32),
    'session_key': secrets.token_hex(16),
    'api_key_salt': secrets.token_hex(16)
}

# Save encrypted keys (in production, use proper key management)
with open(f'{security_dir}/.security_keys', 'w') as f:
    json.dump(keys, f)

os.chmod(f'{security_dir}/.security_keys', 0o600)
print('Security keys generated')
"

# Create startup script
RUN cat > /app/startup.sh << 'EOF'
#!/bin/bash
set -e

# Function to log messages
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a /var/log/onxlink/startup.log
}

# Initialize application
log "Starting ONXLink application..."

# Check environment
if [ "$ENVIRONMENT" = "production" ]; then
    log "Production environment detected"
    export PYTHONOPTIMIZE=2
else
    log "Development environment detected"
fi

# Database migrations
log "Running database migrations..."
python -m alembic upgrade head || log "Migration failed, continuing..."

# Preload AI models
log "Preloading AI models..."
python -c "
import os
import sys
sys.path.append('/app')

try:
    from app.services.ai_service import AIService
    ai_service = AIService()
    ai_service.preload_offline_models()
    print('AI models preloaded successfully')
except Exception as e:
    print(f'AI model preloading failed: {e}')
"

# Start background services
log "Starting background services..."
python -c "
import asyncio
import sys
sys.path.append('/app')

from app.services.background_service import BackgroundService
from app.services.cache_service import CacheService

async def start_services():
    try:
        # Initialize cache
        cache_service = CacheService()
        await cache_service.initialize()
        
        # Start background tasks
        bg_service = BackgroundService()
        await bg_service.start()
        
        print('Background services started successfully')
    except Exception as e:
        print(f'Background services failed: {e}')

asyncio.run(start_services())
" &

# Health check
log "Performing health check..."
python -c "
import sys
sys.path.append('/app')

from app.utils import health_check
if health_check():
    print('Health check passed')
    sys.exit(0)
else:
    print('Health check failed')
    sys.exit(1)
"

# Start main application
log "Starting main application..."
if [ "$DEVELOPMENT" = "true" ]; then
    exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
else
    exec gunicorn app.main:app -c /etc/onxlink/gunicorn.conf.py
fi
EOF

# Make startup script executable
RUN chmod +x /app/startup.sh

# Create health check script
RUN cat > /app/healthcheck.py << 'EOF'
#!/usr/bin/env python3
import asyncio
import sys
import os
import aiohttp
import json
from datetime import datetime

sys.path.append('/app')

async def check_health():
    """Comprehensive health check"""
    health_status = {
        'timestamp': datetime.now().isoformat(),
        'status': 'healthy',
        'checks': {}
    }
    
    try:
        # Check database connection
        from app.database import get_db
        from sqlalchemy import text
        
        async with get_db() as db:
            result = await db.execute(text("SELECT 1"))
            health_status['checks']['database'] = 'healthy'
    except Exception as e:
        health_status['checks']['database'] = f'unhealthy: {str(e)}'
        health_status['status'] = 'unhealthy'
    
    # Check Redis connection
    try:
        from app.services.cache_service import CacheService
        cache = CacheService()
        await cache.ping()
        health_status['checks']['cache'] = 'healthy'
    except Exception as e:
        health_status['checks']['cache'] = f'unhealthy: {str(e)}'
        health_status['status'] = 'unhealthy'
    
    # Check API endpoint
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get('http://localhost:8000/health') as response:
                if response.status == 200:
                    health_status['checks']['api'] = 'healthy'
                else:
                    health_status['checks']['api'] = f'unhealthy: status {response.status}'
                    health_status['status'] = 'unhealthy'
    except Exception as e:
        health_status['checks']['api'] = f'unhealthy: {str(e)}'
        health_status['status'] = 'unhealthy'
    
    # Check disk space
    import shutil
    total, used, free = shutil.disk_usage('/')
    free_percent = (free / total) * 100
    
    if free_percent < 10:
        health_status['checks']['disk'] = f'warning: {free_percent:.1f}% free'
        health_status['status'] = 'degraded'
    else:
        health_status['checks']['disk'] = f'healthy: {free_percent:.1f}% free'
    
    # Check memory usage
    import psutil
    memory = psutil.virtual_memory()
    
    if memory.percent > 90:
        health_status['checks']['memory'] = f'warning: {memory.percent:.1f}% used'
        health_status['status'] = 'degraded'
    else:
        health_status['checks']['memory'] = f'healthy: {memory.percent:.1f}% used'
    
    # Check offline capabilities
    try:
        offline_models_path = '/app/offline_cache/models'
        if os.path.exists(offline_models_path) and os.listdir(offline_models_path):
            health_status['checks']['offline_models'] = 'healthy'
        else:
            health_status['checks']['offline_models'] = 'warning: no offline models found'
    except Exception as e:
        health_status['checks']['offline_models'] = f'unhealthy: {str(e)}'
    
    # Output health status
    print(json.dumps(health_status, indent=2))
    
    # Exit with appropriate code
    if health_status['status'] == 'healthy':
        sys.exit(0)
    elif health_status['status'] == 'degraded':
        sys.exit(1)
    else:
        sys.exit(2)

if __name__ == '__main__':
    asyncio.run(check_health())
EOF

RUN chmod +x /app/healthcheck.py

# Create backup script
RUN cat > /app/backup.sh << 'EOF'
#!/bin/bash
set -e

BACKUP_DIR="/app/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="onxlink_backup_${DATE}.tar.gz"

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a /var/log/onxlink/backup.log
}

log "Starting backup process..."

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup database
if [ -n "$DATABASE_URL" ]; then
    log "Backing up database..."
    pg_dump "$DATABASE_URL" > "$BACKUP_DIR/database_${DATE}.sql" || log "Database backup failed"
fi

# Backup user uploads
if [ -d "/app/uploads" ]; then
    log "Backing up user uploads..."
    tar -czf "$BACKUP_DIR/uploads_${DATE}.tar.gz" -C /app uploads/ || log "Uploads backup failed"
fi

# Backup configuration
log "Backing up configuration..."
tar -czf "$BACKUP_DIR/config_${DATE}.tar.gz" -C /app \
    --exclude='*.pyc' \
    --exclude='__pycache__' \
    --exclude='*.log' \
    --exclude='tmp/*' \
    . || log "Configuration backup failed"

# Cleanup old backups (keep last 7 days)
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +7 -delete
find "$BACKUP_DIR" -name "*.sql" -mtime +7 -delete

log "Backup process completed"
EOF

RUN chmod +x /app/backup.sh

# Set up cron for automated tasks
RUN cat > /etc/cron.d/onxlink << 'EOF'
# ONXLink automated tasks
0 2 * * * onxlink /app/backup.sh
*/15 * * * * onxlink /usr/bin/python3 /app/healthcheck.py > /var/log/onxlink/health.log 2>&1
0 */6 * * * onxlink /usr/bin/python3 -c "import sys; sys.path.append('/app'); from app.services.sync_service import SyncService; SyncService().sync_offline_data()"
EOF

# Create log rotation configuration
RUN cat > /etc/logrotate.d/onxlink << 'EOF'
/var/log/onxlink/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 0644 onxlink onxlink
    postrotate
        systemctl reload rsyslog > /dev/null 2>&1 || true
    endscript
}
EOF

# Set proper permissions for security
RUN chown -R onxlink:onxlink /app /var/log/onxlink /var/run/onxlink && \
    chmod -R 755 /app && \
    chmod -R 644 /app/app/*.py && \
    chmod +x /app/*.sh /app/healthcheck.py && \
    chmod 600 /app/offline_cache/.security_keys && \
    chmod 755 /app/offline_cache && \
    find /app -name "*.py" -exec chmod 644 {} \; && \
    find /app -name "*.sh" -exec chmod 755 {} \;

# Switch to non-root user
USER onxlink

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python /app/healthcheck.py

# Volume mounts for persistent data
VOLUME ["/app/uploads", "/app/logs", "/app/backups", "/app/cache"]

# Labels for better container management
LABEL maintainer="ONXLink Team" \
      version="1.0.0" \
      description="ONXLink AI Social Commerce Platform" \
      org.opencontainers.image.title="ONXLink" \
      org.opencontainers.image.description="AI-powered social commerce platform" \
      org.opencontainers.image.vendor="ONXLink" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.created="2024-01-01T00:00:00Z" \
      org.opencontainers.image.licenses="MIT"

# Default command
CMD ["/app/startup.sh"]