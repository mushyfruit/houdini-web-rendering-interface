#!/bin/bash

# Houdini 22 reads `hserver.ini` from `~/.local/share/sidefx`, older versions from `~/houdiniX.Y`.
for hserver_dir in "$HOME/houdini$HFS_TARGET" "$HOME/.local/share/sidefx"; do
    mkdir -p "$hserver_dir"
    echo "APIKey=www.sidefx.com $SIDEFX_CLIENT $SIDEFX_SECRET" > "$hserver_dir/hserver.ini"
done

echo "Configuring license server..."
hserver -S https://www.sidefx.com/license/sesinetd

cd /opt/houdini/build/
source ./houdini_setup
cd - > /dev/null 2>&1

# The app imports `hou` from Python rather than hython, so mirror hython's environment.
# Houdini 22 ships tcmalloc, older versions shipped jemalloc.
for allocator in /opt/houdini/build/dsolib/libtcmalloc_minimal.so.4 /opt/houdini/build/dsolib/libjemalloc.so; do
    if [ -f "$allocator" ]; then
        export LD_PRELOAD="$allocator"
        break
    fi
done

# Houdini's bundled lxml expects libiconv to already be loaded, as it is by hython.
if [ -f /opt/houdini/build/dsolib/libiconv.so.2 ]; then
    export LD_PRELOAD="$LD_PRELOAD /opt/houdini/build/dsolib/libiconv.so.2"
fi

# Set by hython, and required by SideFX Labs' pythonrc.py.
export HOUDINI_USER_PREF_DIR="$HOME/houdini$HFS_TARGET"

# Python's own modules (e.g. ssl) load before `hou` and must resolve to Houdini's libraries.
export LD_LIBRARY_PATH="/opt/houdini/build/dsolib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

echo "Houdini setup sourced successfully."

