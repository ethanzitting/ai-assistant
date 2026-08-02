// Where every transaction starts. A real row in `categories` so the foreign key accepts it, but
// inactive so it is never offered as a button. Nothing is ever left NULL: "not yet sorted" is a
// state worth naming, and a NULL would read as a bug at every call site.
export const UNSORTED_CATEGORY = "Unsorted";
