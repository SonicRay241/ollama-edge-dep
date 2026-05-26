local api_keys_str = os.getenv("API_KEYS") or ""
local authorized = false

for key in string.gmatch(api_keys_str, "([^,]+)") do
    local trimmed = string.match(key, "^%s*(.-)%s*$")
    if trimmed and trimmed ~= "" then
        local auth_header = ngx.var.http_authorization
        if auth_header then
            local token = string.match(auth_header, "^Bearer%s+(.+)$")
            if token and token == trimmed then
                authorized = true
                break
            end
        end
    end
end

if not authorized then
    ngx.header["WWW-Authenticate"] = 'Bearer realm="API"'
    ngx.status = 401
    ngx.say("Unauthorized")
    ngx.exit(401)
end