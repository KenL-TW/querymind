import re
import pathlib

root = pathlib.Path(r'C:\Users\User\Desktop\db agent\querymind\frontend')
pattern = re.compile(r'\\u([0-9a-fA-F]{4})')


def decode(m: re.Match) -> str:
    return chr(int(m.group(1), 16))


exts = {'.vue', '.ts', '.js'}
fixed = 0
for f in root.rglob('*'):
    if f.suffix not in exts:
        continue
    if 'node_modules' in str(f):
        continue
    text = f.read_text(encoding='utf-8')
    new_text = pattern.sub(decode, text)
    if new_text != text:
        f.write_text(new_text, encoding='utf-8')
        print('Fixed:', f.name)
        fixed += 1

print(f'Done. Fixed {fixed} files.')
