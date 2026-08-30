# Windows 初级版验收清单

请在干净的 Windows 10 或 Windows 11 用户账户中测试。

## 安装

- [ ] 先启动一次 DSH Desktop，再退出
- [ ] 解压 ZIP 后运行 `windows-installer/install.ps1`
- [ ] 安装器显示两层插件均已同步
- [ ] 重启 DSH 后设计模式和画布入口出现
- [ ] `windows-installer/health-check.ps1` 不报缺文件

## 基础画布

- [ ] 新建项目无需手输路径
- [ ] 导入已有项目可打开 Windows 文件夹选择器
- [ ] 外部拖入一张图片只出现一张
- [ ] 连续粘贴两张图片都能出现
- [ ] 移动、缩放、删除后切换聊天再回来状态不复活
- [ ] 刷新和重启后恢复上次项目及画布内容
- [ ] 多选两张图片发送至聊天，输入框显示 2 张附件
- [ ] 点击“导出 PNG”得到可打开图片
- [ ] “打开项目文件夹”和“在文件夹中显示”调用资源管理器

## 链接文件和降级

- [ ] 拖入 PSD/AI/SVG/PDF 不让画布白屏
- [ ] 无预览转换器时显示占位预览而非永久加载
- [ ] 未安装 Python 时基础画布仍正常
- [ ] 未安装 Adobe 时点击编辑给出明确错误，画布仍正常
- [ ] 已关联 Photoshop/Illustrator 时能打开对应源文件

## 反馈材料

请附上 Windows 版本、DSH 版本、失败截图、复现步骤和日志：

```text
%USERPROFILE%\.dsh\logs\dsh-canvas-windows.log
```
