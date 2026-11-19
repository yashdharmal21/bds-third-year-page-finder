# BDS 3rd Year Study Page Finder

A static study app for Oral Pathology, General Medicine, and General Surgery. Pick a subject, search its chapter-wise question list, and jump to a suggested printed page in *Mastering the BDS IIIrd Year*.

## Run in VS Code

1. Open this project folder in VS Code.
2. Right-click `docs/index.html` and choose **Open with Live Server**. Install the VS Code Live Server extension if that menu item is missing.
3. In the app, select a subject and choose `Mastering 3rd year.pdf` from your device.
4. Search a question or filter by chapter/group, then tap a book-page button.

On an iPad, open the site in Safari and choose the book from Files (save or copy the PDF onto the iPad first). The question list and viewer stack vertically in portrait and fit side by side in landscape.

The book is read from the local file picker and is not uploaded. The app uses the full volume's printed-page offset: PDF viewer page = printed book page + 4.

## Included question lists

- Oral Pathology: 161 topics from 24 chapters.
- General Medicine: 169 questions from the supplied chapter-wise bank.
- General Surgery: 158 questions from the supplied LAQ/SAQ/practical bank.

General Medicine and Surgery page links are suggested matches based on topic wording in the book text. Check nearby pages for continued answers. Topics without a match are labeled **Not located**.

## Publish temporarily with GitHub Pages

1. Create a GitHub repository for this app and push the project.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select the branch you pushed, and set the folder to **/docs**.
4. Save. GitHub Pages will show the site URL in the Pages settings.

Only the app and question/page index belong in the repository. Do not add the textbook PDF. Each student selects their own local copy in the browser.
