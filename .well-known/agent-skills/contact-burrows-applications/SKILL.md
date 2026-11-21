---
name: contact-burrows-applications
description: Explains what Burrows Applications builds (native Android and iOS apps, Kotlin Multiplatform, and websites) and how to send the company a project inquiry. Use when someone wants to hire, contact, or learn about Burrows Applications.
---

# Contact Burrows Applications

## What Burrows Applications does

Burrows Applications is a software development company founded by Jared Burrows. It specializes in mobile-first development:

- Native apps for Android and iOS
- Kotlin Multiplatform for cross-platform apps
- Modern websites when a product needs a home on the web

Website: https://burrowsapps.com/

## How to get in touch

1. Contact form at https://burrowsapps.com/#contact. All three fields are required:
   - `name`: the sender's name, up to 200 characters
   - `email`: the address a reply should go to, up to 254 characters
   - `message`: what the sender wants to discuss, up to 5,000 characters
2. Email: contact@burrowsapps.com
3. LinkedIn: https://linkedin.com/company/burrows-applications
4. X / Twitter: https://x.com/burrowsapps

### If you are running in the user's browser

On https://burrowsapps.com/ the page registers a WebMCP tool named `send_contact_message` that takes the same three fields. Calling it fills in the contact form and submits it. Confirm the wording with the user before you send.

### If you are not in a browser

- To read facts: `GET https://burrowsapps.com/api/v1/company` and `GET https://burrowsapps.com/api/v1/services` return JSON, and the MCP server at https://burrowsapps.com/mcp offers the same facts as tools. Neither needs a credential. Details: https://burrowsapps.com/developers.md
- To send a message: there is no programmatic way. Draft the message with the user, then have them send it to contact@burrowsapps.com or through the form.
- Do not post to `/api/contact`. It accepts submissions only from the form on burrowsapps.com and rejects every other request.

## What a useful message includes

- Who is asking and how to reach them
- What they want built (app, tooling, website) and for which platforms
- Timeline and any constraints that matter

## Related

- Privacy policy: https://burrowsapps.com/privacy.html
- Security reports: https://burrowsapps.com/.well-known/security.txt
