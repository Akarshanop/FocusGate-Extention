# FocusGate Extension

An overlay that appears on blocked sites and asks a question to help reduce distractions. Supports MCQ, True/False, Short Answer, and Numerical formats.

## How it works
- `background.js` monitors tabs. When a URL matches the blocklist, it sends a message to the content script to show the overlay with a question payload.
- `overlay.js` is a content script injected into all pages; it builds the overlay UI dynamically and renders the question based on the payload it receives.
- `overlay.css` styles the overlay.
- `popup.html/js` provides login/logout and testing actions. It includes a Test Overlay button to render a sample question on the current page.

## Question payload contract
Send a message to the content script with the following shape to render a question:

```
{
  action: 'ask_question',
  payload: {
    requestId: string,                 // Optional but recommended for correlating responses
    question: string,                  // The question text to display
    type: 'mcq'|'truefalse'|'short'|'numerical',
    options?: string[],                // Required for mcq; ignored otherwise
    placeholder?: string,              // Optional for short/numerical inputs
    correctAnswer?: string|number,     // Optional; if provided, basic correctness feedback is shown
    tolerance?: number                 // Optional; numerical tolerance when type is 'numerical'
  }
}
```

- MCQ: provide `options: ["A", "B", ...]`.
- True/False: type `truefalse` (options auto-rendered as True, False).
- Short Answer: free text input.
- Numerical: numeric input; if `correctAnswer` provided, optional `tolerance` is supported.

The overlay sends a reply when the user submits:

```
{
  action: 'overlay_answer',
  requestId: string | undefined,
  payload: {
    answer: string|number,
    type: 'mcq'|'truefalse'|'short'|'numerical',
    correct: boolean                   // true if it matches provided correctAnswer (when supplied)
  }
}
```

## Testing locally
1. Open chrome://extensions, enable Developer mode, click “Load unpacked”, select this folder.
2. Open any normal website (not chrome:// or the Chrome Web Store).
3. Click the extension icon to open the popup and press “Test Overlay” (or the “No Login” variant). The overlay should render on the page.
4. Choose an answer and press Submit. Press Continue to close the overlay.

Note: Content scripts cannot run on chrome:// pages or the Chrome Web Store due to platform restrictions.

## Customization
- To control when questions appear for blocked sites, update the blocklist retrieval in `background.js` and adjust the payload you send with the `show_overlay`/`ask_question` actions.
- UI styling can be adjusted in `overlay.css`.
