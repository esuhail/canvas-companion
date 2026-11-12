# Policy check (11 November 2026)

Read-only session access is technically possible. That does not make public distribution permitted. This file records what the policies say and what is still unanswered.

## Findings

| Source | What it says | Effect on us |
| --- | --- | --- |
| [Instructure Acceptable Use Policy](https://www.instructure.com/policies/acceptable-use) | No access "by any means other than publicly supported interfaces", with scraping as the example. No sharing of credentials. No use the school's own rules do not authorize. No interfering with the service. | The REST API is a documented interface. Reaching it with the browser session from an extension is not a route Instructure documents for third parties. Unresolved. |
| [Instructure API Policy](https://www.instructure.com/policies/canvas-api-policy) | No competitive use. No distributing tools that gather information. No unapproved connection technologies. No use that breaks a school's policies. Rate limits apply. | Extensions are not named. A widely distributed tool is more exposed than personal use. |
| [Canvas OAuth docs](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth) | Apps used by multiple users must use OAuth. Asking users for tokens is a violation. | We use no tokens. But the stated route for multi-user apps is OAuth through a school-issued key, which we do not have. |
| [GMU Policy 1301](https://universitypolicy.gmu.edu/policies/responsible-use-of-computing/) | No access to university resources without proper authorization. Do not let another user into your accounts. Do not use resources to break other policies or the Honor Code. | Does not mention browser extensions. Reading your own data as yourself is not obviously covered or excluded. |
| [GMU Canvas procedures](https://its.gmu.edu/knowledge-base/canvas-procedures-settings/) | New Canvas tools go through the Architectural Standards Review Board. | Written for integrations installed in Canvas, not for software on a student's own computer. Whether it applies is a question for ITS. |
| [GMU LMS support](https://gmu.teamdynamix.com/TDClient/33/Portal/Requests/ServiceOfferingDet?ID=63) | Proctored exams require Chrome and the Honorlock extension. | Disable this extension during proctored exams. It never reads quiz paths. |
| [Chrome Web Store policies](https://developer.chrome.com/docs/webstore/program-policies/policies) | Narrowest permissions. A privacy policy if user data is handled. Data used only for the single disclosed purpose. No facilitating unauthorized access to website content. | Our design fits: one site, asked for at connect time, nothing transmitted. The last clause depends on the two unresolved questions above. |

## Position

| Use | Status |
| --- | --- |
| You, on your own account, loaded unpacked | Proceed. Low risk, not expressly authorized. Stop if GMU says no. |
| A few classmates, loaded unpacked | Wait for a written answer from GMU ITS. |
| Public Chrome Web Store listing | Blocked until GMU ITS answers and Instructure's position is known. |

## Rules the code follows regardless

- GET only, enforced by the transport interface.
- A path allowlist. Quizzes, submissions, conversations and files are not on it.
- No requests while the panel is closed. A pause between pages.
- No server. No analytics. Nothing leaves the browser.
- Stored locally only: the Canvas address, your targets, what-if scores and added work, what was read from a syllabus you supplied, and a snapshot of scores and due dates (no names) for "what changed". Disconnect erases all of it.
- Honest naming in any future listing: independent, not affiliated with Instructure or GMU.

## Question to send GMU ITS (support@gmu.edu)

> I am a GMU CS student building a personal Chrome extension for a portfolio project. It runs only in my browser and reads my own Canvas courses and grades through the Canvas REST API, using my existing signed-in session. It sends only GET requests, never touches quizzes or submissions, stores nothing off my computer, and uses no access token.
>
> 1. Is this permitted for my own use under Policy 1301 and GMU's Canvas guidelines?
> 2. Would it be permitted for other GMU students to install it on their own computers?
> 3. If not, is there a review path, such as the ASRB, for a student-built tool like this?
