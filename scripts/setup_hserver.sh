#!/bin/bash

# APIKey options also can be placed in `hserver.ini`, fka `hserver.opt`
# Houdini 22 reads `hserver.ini` from `~/.local/share/sidefx`, older versions from `~/houdiniX.Y`.
for hserver_dir in /root/houdini$HFS_TARGET /root/.local/share/sidefx; do
    mkdir -p "$hserver_dir"
    echo "APIKey=www.sidefx.com $SIDEFX_CLIENT $SIDEFX_SECRET" > "$hserver_dir/hserver.ini"
done

# hserver will update the `.sesi_licenses.pref` file.
echo "Configuring license server..."
echo "serverhost=https://www.sidefx.com/license/sesinetd" > ~/.sesi_licenses.pref
hserver -S https://www.sidefx.com/license/sesinetd

# Restart
hserver -q
hserver
echo "Server started successfully."

cd /opt/houdini/build/
source ./houdini_setup
cd - > /dev/null 2>&1

# The app imports `hou` from Python rather than running hython, so mirror hython's environment.
# Preload Houdini's memory allocator: Houdini 22 ships tcmalloc, older versions shipped jemalloc.
for allocator in /opt/houdini/build/dsolib/libtcmalloc_minimal.so.4 /opt/houdini/build/dsolib/libjemalloc.so; do
    if [ -f "$allocator" ]; then
        export LD_PRELOAD="$allocator"
        break
    fi
done

# Python's own modules (e.g. ssl, lzma) load before `hou`, so ensure they resolve to the same
# libraries as Houdini. Otherwise `import hou` fails on symbols missing from the system's copies.
export LD_LIBRARY_PATH="/opt/houdini/build/dsolib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

echo "Houdini setup sourced successfully."

