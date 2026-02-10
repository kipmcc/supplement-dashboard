#!/bin/bash
# AviFlow CLI — Programmatic diagram management via Supabase
# Usage: aviflow-cli.sh <command> [args]
#
# Commands:
#   list [project]          List all diagrams (optionally filter by project)
#   get <id>                Get diagram content by ID
#   create <title> [opts]   Create a new diagram
#   update <id> [opts]      Update existing diagram
#   rename <id> <title>     Rename a diagram
#   delete <id>             Delete a diagram
#   versions <id>           List version history
#   export <id>             Export diagram as markdown code block
#
# Options for create/update:
#   --content <text>        ASCII content (or pipe via stdin)
#   --file <path>           Read content from file
#   --project <key>         Project key (e.g. "outpost")
#   --author <name>         Author name (default: $USER)
#   --tags <t1,t2>          Comma-separated tags

SUPABASE_URL="https://xijsvdhffiuxpepswnyb.supabase.co/rest/v1"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpanN2ZGhmZml1eHBlcHN3bnliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNzU0NTYsImV4cCI6MjA4MTc1MTQ1Nn0.Y5igqaP-p4ZvvVP47xvy4SFCyZE030wyuITYIUwWlRI"

CURL_HEADERS=(
  -H "apikey: $ANON_KEY"
  -H "Authorization: Bearer $ANON_KEY"
  -H "Content-Type: application/json"
)

cmd="${1:-help}"
shift 2>/dev/null

case "$cmd" in
  list)
    PROJECT="$1"
    URL="$SUPABASE_URL/diagrams?order=updated_at.desc&limit=50&select=id,title,project_key,created_by,updated_at,version_count"
    [ -n "$PROJECT" ] && URL="$URL&project_key=eq.$PROJECT"
    curl -s "$URL" "${CURL_HEADERS[@]}" | python3 -c "
import sys,json
data = json.load(sys.stdin)
if not data: print('No diagrams found.'); sys.exit()
print(f'{'ID':<38} {'Title':<30} {'Project':<15} {'By':<12} {'Ver':>4}  Updated')
print('-' * 110)
for d in data:
    print(f'{d[\"id\"]:<38} {(d[\"title\"] or \"\")[:29]:<30} {(d.get(\"project_key\") or \"-\")[:14]:<15} {(d.get(\"created_by\") or \"-\")[:11]:<12} {d.get(\"version_count\",0):>4}  {d[\"updated_at\"][:16]}')
"
    ;;

  get)
    ID="$1"
    [ -z "$ID" ] && echo "Usage: aviflow-cli.sh get <id>" && exit 1
    curl -s "$SUPABASE_URL/diagrams?id=eq.$ID" "${CURL_HEADERS[@]}" | python3 -c "
import sys,json
data = json.load(sys.stdin)
if not data: print('Not found'); sys.exit(1)
d = data[0]
print(f'Title: {d[\"title\"]}')
print(f'Project: {d.get(\"project_key\",\"-\")}')
print(f'Author: {d.get(\"created_by\",\"-\")}')
print(f'Versions: {d.get(\"version_count\",0)}')
print(f'Updated: {d[\"updated_at\"]}')
print('---')
print(d['content'])
"
    ;;

  create)
    TITLE="$1"; shift
    CONTENT="" PROJECT="" AUTHOR="${USER:-cli}" TAGS="[]"
    while [ $# -gt 0 ]; do
      case "$1" in
        --content) CONTENT="$2"; shift 2 ;;
        --file) CONTENT="$(cat "$2")"; shift 2 ;;
        --project) PROJECT="$2"; shift 2 ;;
        --author) AUTHOR="$2"; shift 2 ;;
        --tags) TAGS="[$(echo "$2" | sed 's/[^,]*/\"&\"/g')]"; shift 2 ;;
        *) shift ;;
      esac
    done
    # Read from stdin if no content
    [ -z "$CONTENT" ] && ! [ -t 0 ] && CONTENT="$(cat)"
    [ -z "$CONTENT" ] && echo "No content provided (use --content, --file, or pipe stdin)" && exit 1
    [ -z "$TITLE" ] && TITLE="Untitled"

    BODY=$(python3 -c "
import json,sys
print(json.dumps({
  'title': '$TITLE',
  'content': sys.stdin.read(),
  'project_key': '$PROJECT' or None,
  'created_by': '$AUTHOR',
  'tags': $TAGS,
  'version_count': 1
}))
" <<< "$CONTENT")

    RESULT=$(curl -s -X POST "$SUPABASE_URL/diagrams" "${CURL_HEADERS[@]}" -H "Prefer: return=representation" -d "$BODY")
    echo "$RESULT" | python3 -c "
import sys,json
d = json.load(sys.stdin)
if isinstance(d, list): d = d[0]
print(f'Created: {d[\"id\"]}')
print(f'Title: {d[\"title\"]}')
print(f'Project: {d.get(\"project_key\",\"-\")}')
"
    ;;

  update)
    ID="$1"; shift
    CONTENT="" TITLE="" PROJECT=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --content) CONTENT="$2"; shift 2 ;;
        --file) CONTENT="$(cat "$2")"; shift 2 ;;
        --title) TITLE="$2"; shift 2 ;;
        --project) PROJECT="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    [ -z "$CONTENT" ] && ! [ -t 0 ] && CONTENT="$(cat)"

    # Build patch object
    BODY=$(python3 -c "
import json,sys
patch = {'updated_at': __import__('datetime').datetime.utcnow().isoformat() + 'Z'}
content = '''$CONTENT''' if '''$CONTENT''' else None
if content: patch['content'] = content
if '$TITLE': patch['title'] = '$TITLE'
if '$PROJECT': patch['project_key'] = '$PROJECT'
print(json.dumps(patch))
")
    curl -s -X PATCH "$SUPABASE_URL/diagrams?id=eq.$ID" "${CURL_HEADERS[@]}" -H "Prefer: return=representation" -d "$BODY" | python3 -c "
import sys,json
d = json.load(sys.stdin)
if isinstance(d, list) and d: d = d[0]
print(f'Updated: {d.get(\"id\",\"?\")} — {d.get(\"title\",\"?\")}')
"
    ;;

  rename)
    ID="$1" TITLE="$2"
    [ -z "$ID" ] || [ -z "$TITLE" ] && echo "Usage: aviflow-cli.sh rename <id> <new-title>" && exit 1
    curl -s -X PATCH "$SUPABASE_URL/diagrams?id=eq.$ID" "${CURL_HEADERS[@]}" -H "Prefer: return=representation" \
      -d "{\"title\":\"$TITLE\",\"updated_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" | python3 -c "
import sys,json
d = json.load(sys.stdin)
if isinstance(d, list) and d: d = d[0]
print(f'Renamed: {d.get(\"title\",\"?\")}')
"
    ;;

  delete)
    ID="$1"
    [ -z "$ID" ] && echo "Usage: aviflow-cli.sh delete <id>" && exit 1
    curl -s -X DELETE "$SUPABASE_URL/diagram_versions?diagram_id=eq.$ID" "${CURL_HEADERS[@]}" > /dev/null
    curl -s -X DELETE "$SUPABASE_URL/diagrams?id=eq.$ID" "${CURL_HEADERS[@]}" > /dev/null
    echo "Deleted: $ID"
    ;;

  versions)
    ID="$1"
    [ -z "$ID" ] && echo "Usage: aviflow-cli.sh versions <id>" && exit 1
    curl -s "$SUPABASE_URL/diagram_versions?diagram_id=eq.$ID&order=created_at.desc&limit=20" "${CURL_HEADERS[@]}" | python3 -c "
import sys,json
data = json.load(sys.stdin)
if not data: print('No versions found.'); sys.exit()
for i, v in enumerate(data):
    lines = (v.get('content','') or '')[:100].replace('\n','\\\\n')
    print(f'v{len(data)-i}  {v[\"created_at\"][:19]}  by {v.get(\"saved_by\",\"?\"):<12}  {lines}...')
"
    ;;

  export)
    ID="$1"
    [ -z "$ID" ] && echo "Usage: aviflow-cli.sh export <id>" && exit 1
    curl -s "$SUPABASE_URL/diagrams?id=eq.$ID" "${CURL_HEADERS[@]}" | python3 -c "
import sys,json
data = json.load(sys.stdin)
if not data: print('Not found'); sys.exit(1)
print('\`\`\`')
print(data[0]['content'])
print('\`\`\`')
"
    ;;

  *)
    echo "AviFlow CLI — Diagram management"
    echo ""
    echo "Commands:"
    echo "  list [project]           List diagrams"
    echo "  get <id>                 Show diagram"
    echo "  create <title> [opts]    Create new (--content, --file, --project, --author, --tags)"
    echo "  update <id> [opts]       Update (--content, --file, --title, --project)"
    echo "  rename <id> <title>      Rename"
    echo "  delete <id>              Delete"
    echo "  versions <id>            Version history"
    echo "  export <id>              Export as markdown"
    ;;
esac
