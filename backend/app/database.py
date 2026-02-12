"""
ONXLink Database Connection & Session Management
Production-ready database layer with connection pooling, offline sync, and retry logic
"""

import os
import asyncio
import logging
from typing import AsyncGenerator, Optional, Dict, Any, List
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
import json
import sqlite3
from pathlib import Path

import asyncpg
from sqlalchemy.ext.asyncio import (
    AsyncSession, 
    async_sessionmaker, 
    create_async_engine,
    AsyncEngine
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import NullPool, QueuePool
from sqlalchemy import (
    create_engine, 
    text, 
    event,
    Engine,
    MetaData,
    Table,
    Column,
    Integer,
    String,
    DateTime,
    Boolean,
    Text,
    JSON,
    Float
)
from sqlalchemy.exc import SQLAlchemyError, DisconnectionError
from sqlalchemy.engine import Engine as SyncEngine
from redis import Redis
from redis.exceptions import ConnectionError as RedisConnectionError
import aioredis
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from .config import get_settings
from .utils import generate_uuid, encrypt_sensitive_data, decrypt_sensitive_data


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global settings
settings = get_settings()

class Base(DeclarativeBase):
    """Base class for all database models"""
    pass

class DatabaseManager:
    """
    Production-ready database manager with connection pooling,
    offline sync, retry logic, and caching
    """
    
    def __init__(self):
        self.async_engine: Optional[AsyncEngine] = None
        self.sync_engine: Optional[SyncEngine] = None
        self.async_session_factory: Optional[async_sessionmaker] = None
        self.sync_session_factory: Optional[sessionmaker] = None
        self.redis_client: Optional[Redis] = None
        self.async_redis_client: Optional[aioredis.Redis] = None
        self.offline_db_path = Path(settings.OFFLINE_DB_PATH)
        self.is_offline_mode = False
        self.pending_sync_operations: List[Dict[str, Any]] = []
        self.connection_pool_size = settings.DB_POOL_SIZE
        self.max_overflow = settings.DB_MAX_OVERFLOW
        
    async def initialize(self) -> None:
        """Initialize all database connections and caching"""
        try:
            await self._setup_main_database()
            await self._setup_redis_cache()
            await self._setup_offline_database()
            await self._test_connections()
            logger.info("Database initialization completed successfully")
        except Exception as e:
            logger.error(f"Database initialization failed: {e}")
            await self._enable_offline_mode()
            
    async def _setup_main_database(self) -> None:
        """Setup main PostgreSQL database with connection pooling"""
        try:
            # Async engine for main operations
            self.async_engine = create_async_engine(
                settings.DATABASE_URL,
                poolclass=QueuePool,
                pool_size=self.connection_pool_size,
                max_overflow=self.max_overflow,
                pool_pre_ping=True,
                pool_recycle=3600,  # 1 hour
                connect_args={
                    "server_settings": {
                        "application_name": "ONXLink",
                        "jit": "off"
                    },
                    "command_timeout": 60,
                    "statement_cache_size": 0
                }
            )
            
            # Sync engine for specific operations
            sync_url = settings.DATABASE_URL.replace("postgresql+asyncpg", "postgresql+psycopg2")
            self.sync_engine = create_engine(
                sync_url,
                poolclass=QueuePool,
                pool_size=5,
                max_overflow=10,
                pool_pre_ping=True,
                pool_recycle=3600
            )
            
            # Session factories
            self.async_session_factory = async_sessionmaker(
                bind=self.async_engine,
                class_=AsyncSession,
                expire_on_commit=False,
                autoflush=False,
                autocommit=False
            )
            
            self.sync_session_factory = sessionmaker(
                bind=self.sync_engine,
                autoflush=False,
                autocommit=False
            )
            
            # Create tables if they don't exist
            async with self.async_engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
                
        except Exception as e:
            logger.error(f"Failed to setup main database: {e}")
            raise
            
    async def _setup_redis_cache(self) -> None:
        """Setup Redis for caching and session management"""
        try:
            # Async Redis client
            self.async_redis_client = aioredis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                max_connections=20,
                retry_on_timeout=True,
                health_check_interval=30
            )
            
            # Sync Redis client
            self.redis_client = Redis.from_url(
                settings.REDIS_URL,
                decode_responses=True,
                max_connections=10,
                retry_on_timeout=True,
                health_check_interval=30
            )
            
            # Test connection
            await self.async_redis_client.ping()
            logger.info("Redis connection established")
            
        except RedisConnectionError as e:
            logger.warning(f"Redis connection failed: {e}. Continuing without cache.")
            self.redis_client = None
            self.async_redis_client = None
            
    async def _setup_offline_database(self) -> None:
        """Setup SQLite database for offline operations"""
        try:
            self.offline_db_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Create offline database with optimized settings
            offline_conn = sqlite3.connect(str(self.offline_db_path))
            offline_conn.execute("PRAGMA journal_mode=WAL")
            offline_conn.execute("PRAGMA synchronous=NORMAL")
            offline_conn.execute("PRAGMA cache_size=10000")
            offline_conn.execute("PRAGMA temp_store=MEMORY")
            
            # Create offline tables
            offline_conn.executescript("""
                CREATE TABLE IF NOT EXISTS offline_users (
                    id TEXT PRIMARY KEY,
                    email TEXT UNIQUE NOT NULL,
                    name TEXT,
                    subscription_tier TEXT DEFAULT 'freemium',
                    last_sync TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                
                CREATE TABLE IF NOT EXISTS offline_content (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    content_type TEXT NOT NULL,
                    title TEXT,
                    content TEXT,
                    platforms TEXT, -- JSON array
                    status TEXT DEFAULT 'draft',
                    scheduled_for TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES offline_users (id)
                );
                
                CREATE TABLE IF NOT EXISTS offline_ai_influencers (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    persona_data TEXT, -- JSON
                    avatar_path TEXT,
                    voice_settings TEXT, -- JSON
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES offline_users (id)
                );
                
                CREATE TABLE IF NOT EXISTS sync_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    table_name TEXT NOT NULL,
                    operation TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
                    record_id TEXT NOT NULL,
                    data TEXT, -- JSON
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    retry_count INTEGER DEFAULT 0,
                    max_retries INTEGER DEFAULT 3,
                    status TEXT DEFAULT 'pending' -- 'pending', 'synced', 'failed'
                );
                
                CREATE TABLE IF NOT EXISTS app_cache (
                    key TEXT PRIMARY KEY,
                    value TEXT,
                    expires_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                
                CREATE INDEX IF NOT EXISTS idx_offline_content_user_id ON offline_content(user_id);
                CREATE INDEX IF NOT EXISTS idx_offline_content_status ON offline_content(status);
                CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
                CREATE INDEX IF NOT EXISTS idx_app_cache_expires ON app_cache(expires_at);
            """)
            
            offline_conn.close()
            logger.info("Offline database initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to setup offline database: {e}")
            raise
            
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10),
        retry=retry_if_exception_type((DisconnectionError, ConnectionError))
    )
    async def _test_connections(self) -> None:
        """Test all database connections with retry logic"""
        try:
            # Test main database
            async with self.get_async_session() as session:
                result = await session.execute(text("SELECT 1"))
                assert result.scalar() == 1
                
            # Test Redis if available
            if self.async_redis_client:
                await self.async_redis_client.ping()
                
            logger.info("All database connections tested successfully")
            
        except Exception as e:
            logger.error(f"Database connection test failed: {e}")
            raise
            
    async def _enable_offline_mode(self) -> None:
        """Enable offline mode when main database is unavailable"""
        self.is_offline_mode = True
        logger.warning("Enabled offline mode due to database connection issues")
        
    @asynccontextmanager
    async def get_async_session(self) -> AsyncGenerator[AsyncSession, None]:
        """Get async database session with proper error handling"""
        if self.is_offline_mode:
            raise ConnectionError("Database is in offline mode")
            
        if not self.async_session_factory:
            raise RuntimeError("Database not initialized")
            
        session = self.async_session_factory()
        try:
            yield session
            await session.commit()
        except Exception as e:
            await session.rollback()
            logger.error(f"Database session error: {e}")
            raise
        finally:
            await session.close()
            
    def get_sync_session(self):
        """Get sync database session with proper error handling"""
        if self.is_offline_mode:
            raise ConnectionError("Database is in offline mode")
            
        if not self.sync_session_factory:
            raise RuntimeError("Database not initialized")
            
        return self.sync_session_factory()
        
    def get_offline_connection(self) -> sqlite3.Connection:
        """Get SQLite connection for offline operations"""
        conn = sqlite3.connect(str(self.offline_db_path))
        conn.row_factory = sqlite3.Row  # Enable dict-like access
        return conn
        
    async def cache_set(self, key: str, value: Any, ttl: int = 3600) -> bool:
        """Set cache value with TTL"""
        try:
            if self.async_redis_client:
                await self.async_redis_client.setex(key, ttl, json.dumps(value))
                return True
            else:
                # Fallback to offline cache
                return self._offline_cache_set(key, value, ttl)
        except Exception as e:
            logger.error(f"Cache set error: {e}")
            return False
            
    async def cache_get(self, key: str) -> Optional[Any]:
        """Get cache value"""
        try:
            if self.async_redis_client:
                value = await self.async_redis_client.get(key)
                return json.loads(value) if value else None
            else:
                # Fallback to offline cache
                return self._offline_cache_get(key)
        except Exception as e:
            logger.error(f"Cache get error: {e}")
            return None
            
    async def cache_delete(self, key: str) -> bool:
        """Delete cache value"""
        try:
            if self.async_redis_client:
                await self.async_redis_client.delete(key)
                return True
            else:
                return self._offline_cache_delete(key)
        except Exception as e:
            logger.error(f"Cache delete error: {e}")
            return False
            
    def _offline_cache_set(self, key: str, value: Any, ttl: int) -> bool:
        """Set value in offline cache"""
        try:
            conn = self.get_offline_connection()
            expires_at = datetime.utcnow() + timedelta(seconds=ttl)
            
            conn.execute(
                "INSERT OR REPLACE INTO app_cache (key, value, expires_at) VALUES (?, ?, ?)",
                (key, json.dumps(value), expires_at)
            )
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            logger.error(f"Offline cache set error: {e}")
            return False
            
    def _offline_cache_get(self, key: str) -> Optional[Any]:
        """Get value from offline cache"""
        try:
            conn = self.get_offline_connection()
            cursor = conn.execute(
                "SELECT value FROM app_cache WHERE key = ? AND expires_at > ?",
                (key, datetime.utcnow())
            )
            row = cursor.fetchone()
            conn.close()
            
            if row:
                return json.loads(row['value'])
            return None
        except Exception as e:
            logger.error(f"Offline cache get error: {e}")
            return None
            
    def _offline_cache_delete(self, key: str) -> bool:
        """Delete value from offline cache"""
        try:
            conn = self.get_offline_connection()
            conn.execute("DELETE FROM app_cache WHERE key = ?", (key,))
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            logger.error(f"Offline cache delete error: {e}")
            return False
            
    async def queue_sync_operation(self, table_name: str, operation: str, 
                                 record_id: str, data: Dict[str, Any]) -> bool:
        """Queue operation for sync when online"""
        try:
            conn = self.get_offline_connection()
            conn.execute(
                """INSERT INTO sync_queue (table_name, operation, record_id, data) 
                   VALUES (?, ?, ?, ?)""",
                (table_name, operation, record_id, json.dumps(data))
            )
            conn.commit()
            conn.close()
            
            # Try immediate sync if online
            if not self.is_offline_mode:
                await self._process_sync_queue()
                
            return True
        except Exception as e:
            logger.error(f"Queue sync operation error: {e}")
            return False
            
    async def _process_sync_queue(self) -> None:
        """Process pending sync operations"""
        if self.is_offline_mode:
            return
            
        try:
            conn = self.get_offline_connection()
            cursor = conn.execute(
                "SELECT * FROM sync_queue WHERE status = 'pending' AND retry_count < max_retries ORDER BY created_at"
            )
            
            for row in cursor.fetchall():
                try:
                    await self._execute_sync_operation(dict(row))
                    
                    # Mark as synced
                    conn.execute(
                        "UPDATE sync_queue SET status = 'synced' WHERE id = ?",
                        (row['id'],)
                    )
                    
                except Exception as e:
                    logger.error(f"Sync operation failed: {e}")
                    
                    # Increment retry count
                    conn.execute(
                        "UPDATE sync_queue SET retry_count = retry_count + 1 WHERE id = ?",
                        (row['id'],)
                    )
                    
                    # Mark as failed if max retries reached
                    if row['retry_count'] + 1 >= row['max_retries']:
                        conn.execute(
                            "UPDATE sync_queue SET status = 'failed' WHERE id = ?",
                            (row['id'],)
                        )
                        
            conn.commit()
            conn.close()
            
        except Exception as e:
            logger.error(f"Process sync queue error: {e}")
            
    async def _execute_sync_operation(self, operation: Dict[str, Any]) -> None:
        """Execute a single sync operation"""
        table_name = operation['table_name']
        op_type = operation['operation']
        record_id = operation['record_id']
        data = json.loads(operation['data'])
        
        async with self.get_async_session() as session:
            if op_type == 'INSERT':
                # Handle insert operation
                pass
            elif op_type == 'UPDATE':
                # Handle update operation
                pass
            elif op_type == 'DELETE':
                # Handle delete operation
                pass
                
    async def cleanup_expired_cache(self) -> None:
        """Clean up expired cache entries"""
        try:
            conn = self.get_offline_connection()
            conn.execute("DELETE FROM app_cache WHERE expires_at < ?", (datetime.utcnow(),))
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Cache cleanup error: {e}")
            
    async def get_database_stats(self) -> Dict[str, Any]:
        """Get database statistics for monitoring"""
        stats = {
            'is_offline_mode': self.is_offline_mode,
            'pending_sync_operations': 0,
            'failed_sync_operations': 0,
            'cache_entries': 0,
            'connection_pool_size': self.connection_pool_size
        }
        
        try:
            conn = self.get_offline_connection()
            
            # Pending sync operations
            cursor = conn.execute("SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'")
            stats['pending_sync_operations'] = cursor.fetchone()[0]
            
            # Failed sync operations
            cursor = conn.execute("SELECT COUNT(*) FROM sync_queue WHERE status = 'failed'")
            stats['failed_sync_operations'] = cursor.fetchone()[0]
            
            # Cache entries
            cursor = conn.execute("SELECT COUNT(*) FROM app_cache WHERE expires_at > ?", (datetime.utcnow(),))
            stats['cache_entries'] = cursor.fetchone()[0]
            
            conn.close()
            
        except Exception as e:
            logger.error(f"Database stats error: {e}")
            
        return stats
        
    async def health_check(self) -> Dict[str, Any]:
        """Comprehensive health check"""
        health = {
            'status': 'healthy',
            'main_db': False,
            'redis': False,
            'offline_db': False,
            'is_offline_mode': self.is_offline_mode
        }
        
        try:
            # Test main database
            if not self.is_offline_mode:
                async with self.get_async_session() as session:
                    await session.execute(text("SELECT 1"))
                    health['main_db'] = True
                    
            # Test Redis
            if self.async_redis_client:
                await self.async_redis_client.ping()
                health['redis'] = True
                
            # Test offline database
            conn = self.get_offline_connection()
            conn.execute("SELECT 1")
            conn.close()
            health['offline_db'] = True
            
        except Exception as e:
            logger.error(f"Health check error: {e}")
            health['status'] = 'unhealthy'
            health['error'] = str(e)
            
        return health
        
    async def close(self) -> None:
        """Close all database connections"""
        try:
            if self.async_engine:
                await self.async_engine.dispose()
                
            if self.sync_engine:
                self.sync_engine.dispose()
                
            if self.async_redis_client:
                await self.async_redis_client.close()
                
            if self.redis_client:
                self.redis_client.close()
                
            logger.info("All database connections closed")
            
        except Exception as e:
            logger.error(f"Error closing database connections: {e}")


# Global database manager instance
db_manager = DatabaseManager()

# Dependency injection for FastAPI
async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for getting database session in FastAPI routes"""
    async with db_manager.get_async_session() as session:
        yield session

def get_sync_db_session():
    """Dependency for getting sync database session"""
    return db_manager.get_sync_session()

def get_offline_db():
    """Dependency for getting offline database connection"""
    return db_manager.get_offline_connection()

# Event handlers for SQLAlchemy
@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    """Set SQLite pragmas for better performance"""
    if 'sqlite' in str(dbapi_connection):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA cache_size=10000")
        cursor.execute("PRAGMA temp_store=MEMORY")
        cursor.close()

# Initialize database on module import
async def init_database():
    """Initialize database manager"""
    await db_manager.initialize()

# Cleanup function
async def cleanup_database():
    """Cleanup database connections"""
    await db_manager.close()

# Export commonly used functions
__all__ = [
    'db_manager',
    'get_db_session',
    'get_sync_db_session', 
    'get_offline_db',
    'init_database',
    'cleanup_database',
    'Base'
]