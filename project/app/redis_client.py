import datetime
import functools
import hashlib
import os
import redis

import app.constants as cnst


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

            # Flush the DB for testing purposes.
            cls._client_instance.flushdb()

        return cls._client_instance


def with_redis_conn(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        redis_conn = RedisClient.get_client_instance()
        return func(redis_conn, *args, **kwargs)

    return wrapper


def get_client_instance():
    return RedisClient.get_client_instance()


def get_file_hash(hip_file, buffer_size=16384):
    """Hash the contents of a FileStorage object with a given buffer size."""
    sha256 = hashlib.sha256()
    hip_file.seek(0)

    while True:
        data = hip_file.read(buffer_size)
        if not data:
            break
        sha256.update(data)

    hip_file.seek(0)
    hex_digest = sha256.hexdigest()
    return hex_digest


@with_redis_conn
def has_generated_nanoid(redis_conn, file_uuid):
    stored_nanoid = redis_conn.hget("global:uuid_to_nanoid", file_uuid)
    if stored_nanoid is not None:
        return stored_nanoid.decode('utf-8')


@with_redis_conn
def get_filename_for_nanoid(redis_conn, nano_id):
    stored_filename = redis_conn.hget("global:nanoid_to_uuid", nano_id)
    if stored_filename is not None:
        return stored_filename.decode('utf-8')


@with_redis_conn
def add_shareable_mapping(redis_conn, file_nanoid, file_uuid):
    if not redis_conn.sismember("global:shareable_files", file_nanoid):
        redis_conn.hset(f"global:nanoid_to_uuid", file_nanoid, file_uuid)
        redis_conn.hset(f"global:uuid_to_nanoid", file_uuid, file_nanoid)


@with_redis_conn
def add_unique_filename(redis_conn, user_uuid, original_filename, file_uuid, hip_file):
    """

    """
    file_hash = get_file_hash(hip_file)

    if not redis_conn.sismember("global:file_hashes", file_hash):
        upload_time = datetime.datetime.utcnow()

        # Store the hash for set membership checks.
        redis_conn.sadd("global:file_hashes", file_hash)

        # Store the hash as a key for reverse file uuid lookup.
        redis_conn.hset(f"user:{user_uuid}:hash_to_uuid", file_hash, file_uuid)

        # Store the original .hip file name against the generated file UUID.
        redis_conn.hset(f"file_meta:{file_uuid}", "original_filename", original_filename)
        redis_conn.hset(f"file_meta:{file_uuid}", "upload_time", upload_time.isoformat())

        # Maintain separate set structure for user to test for uniqueness.
        added = redis_conn.sadd(f"user:{user_uuid}:filenames_set", file_uuid)

        # Add to list to ensure order is maintained.
        if added == 1:
            redis_conn.rpush(f"user:{user_uuid}:filenames_list", file_uuid)
        return True, file_hash
    else:
        print("File already exists: {0}:{1}".format(original_filename, file_hash))
        return False, file_hash


@with_redis_conn
def retrieve_uuid_from_filename(redis_conn, user_uuid, file_hash):
    byte_file_hash = redis_conn.hget(f"user:{user_uuid}:hash_to_uuid", file_hash)
    return byte_file_hash.decode("utf-8")


@with_redis_conn
def store_render_data(redis_conn, render_type, hip_file_uuid, filename, node_path, frame_range):
    redis_conn.hset(f"file_render_data:{hip_file_uuid}:{render_type}", node_path, filename)

    # Store latest render time for GLB file exports.
    if render_type == cnst.BackgroundRenderType.glb_file:
        render_time = datetime.datetime.utcnow()
        redis_conn.hset(f"file_render_data:{hip_file_uuid}:render_time", node_path, render_time.isoformat())
        redis_conn.hset(f"file_render_data:{hip_file_uuid}:frame_range", node_path, frame_range)


@with_redis_conn
def get_user_uploaded_file_dicts(redis_conn, user_uuid):
    file_info_list = []
    uploaded_files = redis_conn.lrange(f"user:{user_uuid}:filenames_list", 0, -1)
    if uploaded_files:
        for uploaded_file in uploaded_files:
            file_uuid = uploaded_file.decode("utf-8")
            original_filename = redis_conn.hget(f"file_meta:{file_uuid}", "original_filename")
            if original_filename is not None:
                file_info_list.append({
                    "original_filename": original_filename.decode("utf-8"),
                    "file_uuid": file_uuid,
                    "upload_date": get_file_upload_time(file_uuid),
                })

    if file_info_list:
        for file_dict in file_info_list:
            file_uuid = file_dict["file_uuid"]
            render_keys = [
                cnst.BackgroundRenderType.glb_file,
                cnst.BackgroundRenderType.thumbnail,
                'render_time',
                'frame_range'
            ]

            for key in render_keys:
                data = redis_conn.hgetall(f"file_render_data:{file_uuid}:{key}")
                if data:
                    file_dict[key] = decode_redis_hash(data)

    return file_info_list


def decode_redis_hash(redis_hash):
    return {key.decode('utf-8'): value.decode('utf-8') for key, value in redis_hash.items() if key and value}


@with_redis_conn
def get_file_upload_time(redis_conn, file_uuid):
    iso_upload_time = redis_conn.hget(f"file_meta:{file_uuid}", "upload_time")
    if iso_upload_time:
        return iso_upload_time.decode("utf-8")

    return ""


@with_redis_conn
def _flush_redis_db(redis_conn):
    """Flush the Redis database for testing purposes."""
    redis_conn.flushall()
