import os, sys

BASE = os.path.join(os.path.dirname(__file__), 'public', 'guides')
APTS = ['arenula', 'leonina', 'portico', 'scala', 'trastevere']

# 1. CSS to insert after the #aiChat rule
OLD_CSS = '  #aiChat { display: none; flex-direction: column; gap: 8px; max-height: 260px; overflow-y: auto; padding: 8px 0; }'
NEW_CSS = (
    '  #aiChat { display: none; flex-direction: column; gap: 8px; max-height: 260px; overflow-y: auto; padding: 8px 0; }\n'
    '  /* Smooth scrolling drawer — iOS & Android */\n'
    '  #drawer { -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }\n'
    '  #drawerBody { scroll-behavior: smooth; }\n'
    '  /* AI chat container: scrollable, never grows unbounded */\n'
    '  #romeAiChatVisible {\n'
    '    max-height: 260px;\n'
    '    overflow-y: auto;\n'
    '    -webkit-overflow-scrolling: touch;\n'
    '    overscroll-behavior: contain;\n'
    '    scroll-behavior: smooth;\n'
    '  }'
)

# 2. JS: auto-scroll to bottom when bubble added
OLD_JS = '  d.innerHTML = html;\n  wrap.appendChild(d);\n  return d;\n}'
NEW_JS = '  d.innerHTML = html;\n  wrap.appendChild(d);\n  wrap.scrollTop = wrap.scrollHeight;\n  return d;\n}'

for apt in APTS:
    path = os.path.join(BASE, apt, 'premium_rome_concierge.html')
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    changed = False

    if OLD_CSS in content:
        content = content.replace(OLD_CSS, NEW_CSS, 1)
        changed = True
    else:
        sys.stderr.write(f'WARNING: CSS anchor not found in {apt}\n')

    if OLD_JS in content:
        content = content.replace(OLD_JS, NEW_JS, 1)
        changed = True
    else:
        sys.stderr.write(f'WARNING: JS anchor not found in {apt}\n')

    if changed:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'Patched: {apt}')
    else:
        print(f'No changes: {apt}')
