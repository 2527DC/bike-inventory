#!/usr/bin/env bash
#
# Probe the Zoho Inventory API with the credentials stored in `integration_config`.
#
#   export PGURL='postgresql://USER:PASSWORD@HOST:5432/postgres'
#   bash scripts/zoho-probe.sh                 # summary of brands + categories + items
#   bash scripts/zoho-probe.sh brands          # full brand list
#   bash scripts/zoho-probe.sh categories      # full category tree
#   bash scripts/zoho-probe.sh items           # first 5 items, brand/category columns
#   bash scripts/zoho-probe.sh raw '<url>'     # any URL, pretty-printed JSON
#
# The DB password is NEVER written into this file — it comes from $PGURL so the script is
# safe to commit. Percent-encode `@` in the password as %40 or the URL will not parse.
#
# Read-only: nothing here writes to Zoho or to the database.

set -u

if [ -z "${PGURL:-}" ]; then
  echo "PGURL is not set. Export it first:" >&2
  echo "  export PGURL='postgresql://user:pass@host:5432/postgres'" >&2
  exit 1
fi

PROVIDER="${PROVIDER:-ZOHO_INVENTORY}"
API="https://www.zohoapis.in/inventory/v1"

q() { psql "$PGURL" -tAX -c "select \"$1\" from integration_config where provider='$PROVIDER'"; }

ZCID=$(q clientId)
ZSEC=$(q clientSecret)
ZRT=$(q refreshToken)
ORG=$(q organizationId)

if [ -z "$ZRT" ]; then
  echo "No refreshToken stored for provider $PROVIDER — connect it in Settings > Integrations first." >&2
  exit 1
fi

ZTOKEN=$(curl -s -X POST "https://accounts.zoho.in/oauth/v2/token" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=$ZRT" \
  -d "client_id=$ZCID" \
  -d "client_secret=$ZSEC" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      let j; try { j = JSON.parse(s); } catch { console.error('non-JSON from token endpoint'); process.exit(1); }
      if (!j.access_token) { console.error('AUTH FAILED: ' + (j.error || s)); process.exit(1); }
      console.log(j.access_token);
    })")

[ -z "$ZTOKEN" ] && { echo "could not obtain an access token" >&2; exit 1; }
echo "auth ok  |  org=$ORG  |  provider=$PROVIDER"
echo

get() { curl -s -H "Authorization: Zoho-oauthtoken $ZTOKEN" "$1"; }

pretty() {
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
    try { console.log(JSON.stringify(JSON.parse(s), null, 2)); } catch { console.log(s); }
  })"
}

case "${1:-summary}" in

  brands)
    echo "GET $API/brands"
    get "$API/brands?organization_id=$ORG&per_page=200" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const b = (JSON.parse(s).brands) || [];
      console.log('count: ' + b.length);
      b.forEach(x => console.log(x.brand_id + '  ' + x.name));
    })"
    ;;

  categories)
    echo "GET $API/categories"
    get "$API/categories?organization_id=$ORG&per_page=200" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const c = (JSON.parse(s).categories) || [];
      console.log('count: ' + c.length);
      const byParent = {};
      c.forEach(x => { (byParent[x.parent_category_id] = byParent[x.parent_category_id] || []).push(x); });
      (byParent['-1'] || []).filter(x => x.category_id !== '-1').forEach(p => {
        console.log(p.category_id + '  ' + p.name);
        (byParent[p.category_id] || []).forEach(ch => console.log('    ' + ch.category_id + '  ' + ch.name));
      });
    })"
    ;;

  items)
    echo "GET $API/items"
    get "$API/items?organization_id=$ORG&per_page=5" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const it = (JSON.parse(s).items) || [];
      it.forEach(i => console.log(JSON.stringify({
        item_id: i.item_id, sku: i.sku, name: i.name,
        brand: i.brand, manufacturer: i.manufacturer,
        category_id: i.category_id, category_name: i.category_name,
        vendor_name: i.vendor_name
      }, null, 2)));
    })"
    ;;

  raw)
    [ -z "${2:-}" ] && { echo "usage: bash scripts/zoho-probe.sh raw '<url>'" >&2; exit 1; }
    get "$2" | pretty
    ;;

  summary|*)
    printf 'brands      '
    get "$API/brands?organization_id=$ORG&per_page=200" \
      | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log((j.brands||[]).length + ' rows   sample: ' + (j.brands||[]).slice(0,4).map(b=>b.name).join(', '))})"

    printf 'categories  '
    get "$API/categories?organization_id=$ORG&per_page=200" \
      | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log((j.categories||[]).length + ' rows   sample: ' + (j.categories||[]).filter(c=>c.category_id!=='-1').slice(0,4).map(c=>c.name).join(', '))})"

    printf 'items       '
    get "$API/items?organization_id=$ORG&per_page=200" \
      | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
          const it=(JSON.parse(s).items)||[];
          const nz=f=>it.filter(x=>String(x[f]||'').trim()!=='').length;
          console.log(it.length + ' fetched   brand ' + nz('brand') + '/' + it.length +
                      '   category ' + nz('category_id') + '/' + it.length +
                      '   vendor_name ' + nz('vendor_name') + '/' + it.length);
        })"
    echo
    echo "run 'bash scripts/zoho-probe.sh brands' (or categories / items / raw <url>) for detail"
    ;;
esac
