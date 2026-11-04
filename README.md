# 联盟熊坑布局规划（无尽冬日）

一个纯前端的等距菱形网格落位工具：以「熊坑中心坐标」为基准，把联盟成员的城镇（炉子）、联盟旗子、联盟矿排布在 45° 等距网格上，并可导出布局图片与 CSV 名单。

无需构建、无后端依赖，**纯静态站点**，可直接托管在 Cloudflare Pages / GitHub Pages / 任意静态服务器。

## 功能

- **等距网格**：1 个游戏坐标 = 1 个单元格；X 轴向右下、Y 轴向左下，符合游戏内 45° 视角
- **占地规则**：熊坑 3×3（9 格）、城镇/炉子 2×2（4 格）、联盟旗子 1×1、联盟矿 2×2（红色，矿上不可放炉子）
- **硬互斥**：城镇、旗子、联盟矿、禁用格之间互不重叠，放不下会直接拒绝并提示
- **编辑操作**
  - 点击空白位选中 2×2 吸附位，再填写游戏名放置
  - 双击地图空白处直接加炉子（默认分类「车身」，可输入名称，回车确认）
  - 拖动成员换位（拖到他人身上即交换）、右键删除、Shift+右键标记禁用格、中键拖动地图
  - 撤销 / 恢复（最多 60 步）
- **分类着色**：地球（蓝）、陨石（黄）、车身（绿）、预留（灰）
- **中心坐标矫正**：修改熊坑中心坐标后，整套布局按相同偏移自动平移，导出坐标同步修正
- **地图控制**：默认 12 圈（3–14 可调）、缩放 30%–200%、显示每格坐标、清空城镇
- **导入 / 导出**
  - 导出图片（PNG）：左侧附「成员坐标」清单
  - 导出 CSV：14 列模板（序号、游戏名、布局分类、目标X/Y、圈层、距离熊坑、备注、占地格1-4、对象类型、占地数量）
  - 导入同格式 CSV，或纯名单文本（`名字 628,523` / `628,523 名字`，行首 ★ 表示旗子）
- **自动保存**：所有修改自动写入浏览器 localStorage，下次打开自动恢复最新布局；首次打开内置一份示例布局（`default-data.js`）

## 本地使用

直接双击 `index.html` 即可（无需服务器）。

如需通过 http 访问：

```bash
# 任选其一
python -m http.server 8080
npx serve .
```

## 目录结构

```
index.html        页面结构
styles.css        样式
core.js           纯算法模块（座位/2×2 块/圈层/CSV 解析与生成），Node 与浏览器通用
app.js            画布渲染、交互、导入导出、localStorage 自动保存
default-data.js   内置默认布局数据（首次打开时加载）
core.test.js      算法单测（node core.test.js）
```

## 部署到 Cloudflare Pages

### 方式一：连接 GitHub 仓库（推荐，推送到 GitHub 后自动构建）

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. 授权 GitHub，选择本仓库
3. 构建设置：
   - Framework preset：`None`
   - Build command：**留空**
   - Build output directory：`/`（或留空）
4. 点击 **Save and Deploy**，几十秒后获得 `https://<项目名>.pages.dev`
5. 之后每次 `git push` 都会自动重新部署

### 方式二：命令行直接上传（无需 GitHub 授权 Pages）

```bash
npm i -g wrangler
wrangler login
wrangler pages deploy . --project-name=bearpit-layout
```

## 数据说明

- 布局数据保存在**当前浏览器的 localStorage**（键名 `bearpit.layout.v1`），不上传服务器，换设备 / 清缓存后需重新导入 CSV
- 想跨设备同步，请使用「导出CSV」后在新设备「粘贴名单」导入
- 首次打开（无本地存档）会加载 `default-data.js` 中的内置示例；点「清空城镇」可自行从零开始

## 算法测试

```bash
node core.test.js
```

覆盖座位生成、2×2 块候选位、旗子优先分配、CSV 解析与格式化回环等 25 项断言。
