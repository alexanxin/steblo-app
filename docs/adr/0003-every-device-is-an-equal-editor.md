# Every device is an equal editor

The private Стебло app has an administrator who approves suggestions. Without a server there is no one to enforce an approval step, so every device that syncs can change anything in the tree.

In place of approval there is a history: every change records who made it, from which device and when, and any change can be undone, deletions included. The undo syncs like any other change. The one exception is Erase, which can't be undone (ADR 0007).

Adding permissions later would need a trust model (signed changes, an owner key), which this decision leaves out on purpose.
