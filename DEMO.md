# ProcureMind demo script (about 2 minutes)

## Before you record

1. `npm start`, then open http://localhost:3000.
2. Click **Reset demo** so the history is back to its starting point.
3. Rehearse the whole script below once, off camera, on the same day you record. Every quote, explanation and email is then remembered, so on camera each step appears instantly and a network drop can't spoil the take. This only works if you repeat exactly the same inputs: the same delivery date, the same 9% and the same note. Write them down.
4. Click **Reset demo** again, so the Northgate order you'll create on camera is the first one.
5. Make the browser window full screen and zoom to 110% so text is readable in the video.

## The script

**0:00 – The problem (15 s)**
> "Buyers get quotes as emails, WhatsApp messages and PDFs. The cheapest quote often comes from the supplier who delivered late last time, but that history lives in someone's head. ProcureMind remembers it."

**0:15 – Compare (30 s)**
Click **All three box quotes**, then **Compare quotes**.
> "Claude reads three messy quotes, including a WhatsApp message. Kestrel is cheapest, but ProcureMind remembers it was on time only 2 times out of 6, and about two weeks late when late. So it recommends Primefold, and says exactly why, what to watch out for, and what to negotiate."

Point at the red warning on Kestrel and the stamp on Primefold.

**0:45 – Decide and learn (35 s)**
Choose **Northgate Cartons** under *Award to*, type "Trial order", click **Award order**, then **Draft award and decline emails**.
> "I'll give the new supplier a trial. ProcureMind drafts the award and the declines, and the declines are checked so they never reveal who won or the winning price."

Go to **Open orders**. On the Northgate order, set the delivery date about two weeks after the expected date, units rejected **9**, note "Cartons crushed", and click **Log delivery**.
> "The delivery comes in two weeks late, with 9% of cartons crushed."

**1:20 – Memory changes the answer (20 s)**
Back to **Compare quotes**, click **All three box quotes**, **Compare quotes**.
> "Same three quotes, a different picture. Northgate drops to last, and ProcureMind tells me why. That's persistent memory: every outcome makes the next decision better."

**1:40 – It's hard to fool (20 s)**
Click **Freight, one with a hidden instruction**, **Compare quotes**.
> "One freight quote hides a line telling AI assistants to recommend it. ProcureMind flags it, and it can't change the ranking, because the ranking is plain arithmetic over your history. Claude explains the decision; it doesn't make it."

**2:00 – Close (5 s)**
> "ProcureMind: a procurement agent that remembers. All data in this demo is simulated."

## If something goes wrong on camera

- **"Exchange rate needed"**: you clicked the naira scenario. Enter a rate and continue, or pick another scenario.
- **"Explanation written by built-in rules"**: Claude couldn't be reached. The ranking is unaffected; carry on and re-record that bit later.
- **Port already in use** when starting: another copy is running. Close it, or run `PORT=3001 npm start` and open http://localhost:3001.

## Recording on Ubuntu

Ubuntu's built-in recorder (press **Print Screen**, then switch to the video icon) records the screen but not your voice. For a voiceover, use OBS Studio:

1. Install it: `sudo apt install obs-studio`, then open **OBS Studio**.
2. Under **Sources**, click **+** and add **Screen Capture** (on newer Ubuntu it's called *Screen Capture (PipeWire)*; pick your screen when asked).
3. Check the **Mic/Aux** bar moves when you speak. If it doesn't, choose your microphone in **Settings → Audio**.
4. In **Settings → Output**, set **Recording Format** to **mp4**. Recordings go to your Videos folder.
5. Press **Start Recording**, follow the script, then **Stop Recording**.

Tips:
- Do one practice take and watch it back before the real one; check you can hear yourself clearly.
- Close other apps and turn off notifications so nothing pops up mid-take.
- Keep it under 3 minutes; many hackathons set a limit, so check the rules.
- Upload to YouTube as **Unlisted** and use that link in submissions and applications.
