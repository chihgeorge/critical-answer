### Fixed
- Bank editor: while an image upload is in flight, 載入題庫 and 儲存全部變更 are locked (the buttons read 圖片上傳中…). An upload that lands after a load no longer writes into the newly loaded bank, and one that lands during a save no longer has its new image replaced by the old one (leaving the new file orphaned on R2).
- Bank editor: a load that hangs gives up after 15 seconds and unlocks the editor with an error, instead of staying at 載入中… forever; an image upload gives up after 60 seconds so it can't block saving forever.
