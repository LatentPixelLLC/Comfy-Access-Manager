with open('public/js/assetGrid.js', 'r', encoding='utf-8') as f:
    content = f.read()
idx = content.find('asset-thumb" ${a.media_type')
print(repr(content[idx-50:idx+200]))
