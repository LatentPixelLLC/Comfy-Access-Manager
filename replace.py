with open('public/js/assetGrid.js', 'r', encoding='utf-8') as f:
    content = f.read()

old_row = """                  <div class="row-id">${a.id}</div>\n                  <div class="row-thumb" ${a.media_type === 'video' ?\n`onmouseenter="handleVideoHover(this, ${a.id})"\nonmousemove="handleVideoMove(event, this)"\nonmouseleave="handleVideoLeave(this)"` : ''}>\n                      <img src="/api/assets/${a.id}/thumbnail\""""

new_row = """                  <div class="row-id">${a.id}</div>\n                  <div class="row-thumb" ${a.media_type === 'video' ? `onmouseenter="handleVideoHover(this, ${a.id})" onmousemove="handleVideoMove(event, this)" onmouseleave="handleVideoLeave(this)"` : ''}>\n                      <img src="/api/assets/${a.id}/thumbnail\""""

content = content.replace(old_row, new_row)

with open('public/js/assetGrid.js', 'w', encoding='utf-8') as f:
    f.write(content)
