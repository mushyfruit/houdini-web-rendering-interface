import os
import redis


class RedisClient():
    """Singleton implementation of the redis client to ensure we
    avoid creating unecessary connections.

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
