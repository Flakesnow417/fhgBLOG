import io

p = 'm4probe2.mjs'
s = io.open(p, encoding='utf-8').read()

# 原来直接 JSON.stringify(cdp.evaluate 的表达式)；现在表达式自己已经
# 处理过 events，问题在于 d.events() 里 handlerObjects 是个 Map，
# 而它又被我转成标量了…… 真正的原因是我在表达式里还留了 evr 变量引用。
# 直接把 events 的取值改成纯字面量计算即可。

old = """  const evr = d.events();
  const ev = { hasEvents: !!evr.hasEvents, connected: evr.connected, handlerObjects: evr.handlerObjects };"""

new = """  let ev = { hasEvents: false, connected: null, handlerObjects: null };
  try {
    const evr = d.events();
    ev = {
      hasEvents: evr.hasEvents === true,
      connected: evr.connected === true,
      handlerObjects: typeof evr.handlerObjects === 'number' ? evr.handlerObjects : null,
    };
  } catch (e) {
    ev.error = String(e);
  }"""

assert old in s, 'events anchor missing'
s = s.replace(old, new)

io.open(p, 'w', encoding='utf-8').write(s)
print('patched ok')
