### Fixed
- Image cleanup no longer deletes an image that a save put back into the question bank while the R2 delete was running: such a save is refused (400, upload the image again) instead of saving a bank whose image is about to disappear.
- A stored bank whose `version` is present but not an integer is now unreadable (read-only) instead of being read as version 1, which a save at version 1 would have overwritten. A missing `version` still reads as 1.
- Image cleanup that waits because the stored bank is unreadable or outdated now writes an `image_cleanup_deferred` log line.
