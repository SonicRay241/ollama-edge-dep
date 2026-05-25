#!/bin/sh
set -eu

CONFIG=/etc/nginx/conf.d/default.conf

echo 'map $http_authorization $auth_ok {' > $CONFIG
echo '    default 0;' >> $CONFIG

OLDIFS="$IFS"
IFS=','

for key in $API_KEYS
do
    echo "    ~^Bearer\\\\ ${key}\$ 1;" >> $CONFIG
done

IFS="$OLDIFS"

echo '}' >> $CONFIG

cat >> $CONFIG <<'EOF'

server {
    listen 80;

    location / {

        if ($auth_ok = 0) {
            return 401;
        }

        proxy_pass http://ollama:11434;

        proxy_http_version 1.1;

        proxy_buffering off;
        proxy_request_buffering off;

        proxy_set_header Host $host;
        proxy_set_header Connection "";

        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF

echo "=== GENERATED NGINX CONFIG ==="
cat $CONFIG

nginx -t

exec nginx -g 'daemon off;'