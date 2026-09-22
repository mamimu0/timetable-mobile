# 時間割スマホver

## 公開URL

- **生徒用（クラスを選ぶだけ）**: https://mamimu0.github.io/timetable-mobile/
- **管理用（自分だけ・PDF更新用）**: https://mamimu0.github.io/timetable-mobile/admin.html

管理用URLはどこにもリンクされていないので、このメモかデスクトップのショートカットから開いてください。

## 毎週の更新手順

1. 上の「管理用」URLを開く（既存データを自動で読み込みます）
2. 新しいPDFを選ぶ
3. 「ファイルを書き出す」を押す
4. ダウンロードされた `weeks.json` を GitHub リポジトリの `data` フォルダへ、`g*.ics` を `ics` フォルダへドラッグ&ドロップしてアップロード・Commit
   - リポジトリ: https://github.com/mamimu0/timetable-mobile
5. 1分ほど待てば、生徒側に自動で反映されます（生徒は何もしなくてOK）

## 仕組みのメモ

- GitHub Pages（無料の静的サイト公開）でこのフォルダをそのまま公開しています。
- サーバー処理は無く、PDFの読み取り・カレンダー作成は全部ブラウザ内(JavaScript)で行っています。
- 元のPDF・写真はリポジトリに含めていません(`.gitignore`)。
