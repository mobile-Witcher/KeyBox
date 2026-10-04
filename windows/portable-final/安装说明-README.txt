KeyBox Windows 0.5.0 —— 免安装压缩包版

【怎么用】把整个文件夹解压到任意目录，双击 KeyBox.App.exe（建议建桌面快捷方式）。
无需证书、无需管理员、无需任何前置安装（已内置 .NET 与 Windows App SDK 运行时）。

【重要】必须保持文件夹完整并从本目录启动 exe（非打包 WinUI 3 应用依赖同目录的 resources.pri / Assets / keys.json）。

【配置说明】keys.json 内含环境 ID 与 publishable key（客户端公开密钥，非机密）；
应用启动时读取它来连接云环境。若要换环境，改这一个文件即可。

【数据位置】%APPDATA%\KeyBox\（含会话与设置；删除即恢复初始状态）。主密码与主密钥永不离开本机。