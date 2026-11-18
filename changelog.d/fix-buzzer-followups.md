---
bump: minor
---
### Added
- A multi-field music question's second buzz round has its own narration: the narrator says it is the second and last round for everyone, instead of the plain "same song again" line (#369).

### Fixed
- When the team picking the next category drops offline (during the wait, the reveal or a pause) and has not come back, the room no longer waits for the host: the next question comes in order, as with 「▶ 下一步」 (#370). A server restart, which reads every team offline until it reconnects, does not end the pick.
- A wrong buzz ends the last winner's category pick, so a pause before buzzing reopens can no longer swap a question everyone already heard (#362).
- The host's 指定題目 list in the buzzer phase no longer greys out the question queued for the boss room; picking it plays it now and uses the queue up (#362).
