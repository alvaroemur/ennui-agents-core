#!/usr/bin/env sh
# Libera el puerto PORT (por defecto 3000) para que el servidor pueda arrancar.
PORT=${PORT:-3000}
pid=$(lsof -ti :"$PORT" 2>/dev/null)
if [ -n "$pid" ]; then
  kill -9 $pid 2>/dev/null || true
fi
exit 0
