/* 接龙收集 · 内置兜底活动（云端未配置时使用；与截图的 VOE 参战统计一致） */
window.CHAIN_DEFAULT_ACTS = [
  {
    id: 'voe2026',
    title: 'VOE雪域联赛最新参战统计',
    notice: '发布人已设置填写的内容不会被其他人查看，保护隐私',
    fields: [
      { id: 'f1', label: '游戏昵称（例:不吃香菜）', type: 'text', required: true, placeholder: '例:不吃香菜' },
      { id: 'f2', label: '是否可以让别人控号', type: 'radio', required: true, options: ['是', '否'] },
      { id: 'f3', label: '诺拉远征1等级', type: 'checkbox', required: true, options: ['5级', '4级', '没有'] }
    ]
  }
];

/* 生成匿名提交标识（本地随机，仅用于识别「自己那条」，不含任何身份信息） */
window.chainCid = function (act) {
  var key = 'chain.cid.' + act;
  var v = null;
  try { v = localStorage.getItem(key); } catch (e) { /* 忽略 */ }
  if (!v) {
    v = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem(key, v); } catch (e) { /* 忽略 */ }
  }
  return v;
};
