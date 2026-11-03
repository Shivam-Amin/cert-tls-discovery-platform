#!/bin/bash
# Generate test TLS traffic for the agent to capture
# Usage: ./test-traffic.sh
# Run in another terminal while TLS scan is active

echo "🚀 Generating TLS traffic for testing..."
echo "Run this while: sudo ./agent/agent-linux tls --duration 30s"
echo ""

# Array of domains to test
domains=(
    "https://github.com"
    "https://example.com"
    "https://google.com"
    "https://cloudflare.com"
    "https://stackoverflow.com"
    "https://api.github.com"
    "https://www.wikipedia.org"
)

# Make requests in a loop
count=1
max_requests=20

while [ $count -le $max_requests ]; do
    # Pick a random domain
    domain=${domains[$RANDOM % ${#domains[@]}]}
    
    echo "[$count/$max_requests] Connecting to $domain..."
    
    # Make HTTPS request (silent, follow redirects, timeout 5s)
    curl -s -L --max-time 5 "$domain" > /dev/null 2>&1
    
    # Small delay between requests
    sleep 0.5
    
    ((count++))
done

echo ""
echo "✅ Generated $max_requests TLS connections"
echo "Check your TLS scan results for captured traffic!"
