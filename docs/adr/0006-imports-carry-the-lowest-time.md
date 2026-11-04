# Imported values carry the lowest possible time

Two relatives can import the same GEDCOM file, and each person keeps the same ID on both phones. If imported values carried the time of import, the relative who imported later would silently overwrite every edit the other made in between. Dating them by the file's export date doesn't help, because that is usually about the same day.

So every imported value uses the time `(0, 0)` and a fixed all-zero setter. Any real edit on any phone is later and wins. Identical files give identical values, so they cost no bytes to sync.

The price is that a newer export can't update an older one by itself: re-importing only fills fields that have no value at all. Import never writes to a deleted or erased person.
