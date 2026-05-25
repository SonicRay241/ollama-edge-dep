#!/bin/sh

cat > /etc/nginx/conf.d/default.conf <<EOF
map \$http_authorization \$auth_ok {
    default 0;
EOF

IFS=','

for key in $API_KEYS
do
cat >> /etc/nginx/conf.d/default.conf <<EOF
    "~^Bearer ${key}\$" 1;
EOF
done

cat >> /etc/nginx/conf.d/default.conf <<'EOF'
}

server {
    listen 80;

    client_max_body_size 100M;

    location / {

        if ($auth_ok = 0) {
            return 401;
        }

        proxy_pass http://ollama:11434;

        proxy_http_version 1.1;

        proxy_buffering off;
        proxy_request_buffering off;
        chunked_transfer_encoding on;

        proxy_set_header Host $host;
        proxy_set_header Connection "";

        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF

nginx -g 'daemon off;'