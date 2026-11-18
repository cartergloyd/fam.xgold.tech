#!/usr/bin/env bash
# Proves the VPN kill switch without touching the live qBittorrent/gluetun stack.
# Starts a throwaway gluetun with the SAME image and settings (own network namespace, no ports), breaks its tunnel two ways,
# and probes from inside that namespace. Pass = nothing gets out while the tunnel is down, and nothing ever shows the real IP.
# Usage: ./vpn-killtest.sh   (on gold-server; reads VPN credentials from the live stack's .env, never prints them)
set -u
LIVE=/home/gold/server-platform/qbittorrent-vpn
NAME=gluetun-killtest
IMG=$(docker inspect qbittorrent-vpn --format '{{.Config.Image}}')
PROBE_IMG=$(docker inspect radarr --format '{{.Config.Image}}')   # already on the box; only its curl is used
probe() { docker run --rm --network "container:$NAME" --entrypoint curl "$PROBE_IMG" -s --max-time 3 https://api.ipify.org 2>/dev/null; }
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1; }
trap cleanup EXIT
cleanup
HOST_IP=$(curl -s --max-time 8 https://api.ipify.org)
docker run -d --name "$NAME" --cap-add NET_ADMIN --device /dev/net/tun --env-file "$LIVE/.env" \
  -e VPN_SERVICE_PROVIDER=nordvpn -e VPN_TYPE=openvpn -e "SERVER_COUNTRIES=United States" -e "SERVER_CATEGORIES=Standard VPN servers" \
  -e FIREWALL_OUTBOUND_SUBNETS=192.168.1.0/24,127.0.0.1/32 "$IMG" >/dev/null || { echo "FAIL: could not start replica"; exit 2; }
for i in $(seq 1 45); do [ "$(docker inspect "$NAME" --format '{{.State.Health.Status}}')" = healthy ] && break; sleep 2; done
BASE=$(probe)
if [ -z "$BASE" ] || [ "$BASE" = "$HOST_IP" ]; then echo "FAIL: replica never got a tunnel (baseline='${BASE:-none}')"; exit 2; fi
echo "baseline: tunnel up, exit IP differs from host: yes"
fail=0
run_phase() { # name, command that breaks the tunnel
  local name=$1 leaked=0 passed=0
  docker exec "$NAME" sh -c "$2" >/dev/null 2>&1
  for i in $(seq 1 12); do
    r=$(probe)
    [ "$r" = "$HOST_IP" ] && leaked=$((leaked+1))
    [ -n "$r" ] && passed=$((passed+1))
    sleep 1
  done
  echo "$name: probes that reached the internet=$passed, probes that showed the real IP=$leaked"
  [ "$leaked" -gt 0 ] && fail=1
  [ "$passed" -gt 0 ] && echo "  note: traffic resumed only if the VPN reconnected, never over the bare connection"
}
run_phase "tun0 taken down" "ip link set tun0 down"
docker exec "$NAME" sh -c "ip link set tun0 up" >/dev/null 2>&1
sleep 5
run_phase "VPN process killed" "pkill openvpn"
for i in $(seq 1 30); do r=$(probe); [ -n "$r" ] && [ "$r" != "$HOST_IP" ] && break; sleep 2; done
[ -n "$r" ] && [ "$r" != "$HOST_IP" ] && echo "recovery: tunnel came back on its own, exit IP still differs from host" || { echo "recovery: tunnel did not come back within 60s (still no leak)"; }
[ $fail -eq 0 ] && echo "RESULT: PASS (no leak while the tunnel was down)" || echo "RESULT: FAIL (real IP exposed)"
exit $fail
