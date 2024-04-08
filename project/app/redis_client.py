import os
import redis


class RedisClient:
    """Singleton implementation of the redis client to ensure we
    avoid creating unnecessary connections.

    """

    _client_instance = None

    @classmethod
    def get_client_instance(cls):
        if cls._client_instance is None:
            redis_host = os.getenv('REDIS_HOST', 'redis')
            redis_port = os.getenv('REDIS_PORT', 6379)
            cls._client_instance = redis.Redis(host=redis_host,
                                               port=redis_port,
                                               db=0)
        return cls._client_instance


def get_client_instance():
    return RedisClient.get_client_instance()


def add_unique_filename(user_uuid, original_filename, file_uuid):
    redis_conn = RedisClient.get_client_instance()

    redis_conn.hset(f"user:{user_uuid}", f"file:{file_uuid}", original_filename)

    # Maintain separate set structure to test for uniqueness.
    added = redis_conn.sadd(f"user:{user_uuid}:filenames_set", file_uuid)

    # Add to list to ensure order is maintained.
    if added == 1:
        redis_conn.rpush(f"user:{user_uuid}:filenames_list", file_uuid)


def add_render_id(user_uuid, file_uuid, render_id):
    pass