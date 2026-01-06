## Audio Audit

I want to create a simple internal tool for auditing the Proper Noun pronunciation used in the audio generated via given text prompt. 

The tool should be able to extract proper nouns from the script and create different version of the proper nouns and then generate audio for each version. I should be able to select which version sounds right and that variation of text should be added in the original text and then generate the audio for the final text. 

The tool should be able to handle the following:
- Extract proper nouns from the script
- Create different version of the proper nouns
- Generate audio for each version
- Allow user to select the right version
- Add the right version of the proper noun in the original text
- Generate the audio for the final text
- Save the final text and audio
- Create .pls file of the right pronunciation of the proper nouns used through out different scripts

The text contains - Names (Indian, English, and other languages), Places (Indian, English, and other languages), and Organizations (Indian, English, and other languages), college / university names, as well as short forms of organizations and universities. Eg - IIT, NIT, IIM, ISB, etc.

I will be using eleven labs to generate the audio.

What are different techiniques of pronouncing the proper nouns?

# ElevenLabs Pronunciation Techniques for Indian Proper Nouns
*(Optimized for best TTS output quality)*

This checklist is designed for **audio generation in ElevenLabs**.  
Goal: **maximum naturalness and correctness**, not linguistic purity.

---

## 1. Phonetic Respelling in Plain English (Most Effective)
Rewrite names the way you want them to be spoken.

**Why it works**  
ElevenLabs is English-centric and does not reliably infer Indian phonology.

**Examples**
- Ramesh → `Ruh-mesh`
- Bhavya → `Bhuv-ya`
- Suresh → `Soo-resh`

---

## 2. Schwa Removal via Consonant Locking
Prevent ElevenLabs from inserting extra “uh / ah” sounds.

**Why it works**  
TTS models tend to auto-expand consonants with vowels.

**Examples**
- Vikram → `Vik-ram`
- Bharat → `Bhu-rut`
- Amit → `Uh-mit`

---

## 3. Aspiration Control with Explicit “h”
Force correct Indian aspiration (`bh / kh / th / dh`).

**Why it works**  
Without guidance, ElevenLabs converts these into English equivalents.

**Examples**
- Bhagat → `Bhaa-gut`
- Thakur → `Thaa-kur` (not English “th”)
- Khan → `Khaan`

---

## 4. Short Vowel Forcing
Avoid long English vowel stretches.

**Why it works**  
ElevenLabs naturally elongates vowels unless constrained.

**Guidelines**
- `uh` → अ  
- `aa` → आ  
- `ee` → ई  

**Examples**
- Amit → `Uh-mit`
- Rohit → `Ro-hit`
- Anil → `Uh-nil`

---

## 5. Syllable Timing Using Hyphens
Flatten stress across syllables.

**Why it works**  
Indian names are syllable-timed; English TTS is stress-timed.

**Examples**
- Bangalore → `Ban-ga-lor`
- Hyderabad → `Hai-de-ra-baad`
- Chaitanya → `Chai-tun-ya`

---

## 6. Nasal Sound Approximation
Simulate nasalization using consonants.

**Why it works**  
ElevenLabs cannot reliably nasalize vowels.

**Examples**
- Anand → `Uh-nund`
- Ganga → `Gun-ga`
- Singh → `Sing`

---

## 7. Region-Aware Pronunciation Selection
Choose one regional variant and encode it clearly.

**Why it works**  
ElevenLabs does not infer regional context.

**Examples**
- Shiva  
  - North style → `Shi-va`  
  - South style → `See-va`

- Ramesh  
  - North style → `Ruh-mesh`  
  - South style → `Ra-mesh`

---

## 8. Pause Control Using Ellipses
Insert pauses around names for clarity.

**Why it works**  
Names are often rushed without explicit pause cues.

**Example**
> “This call is with… **Ruh-mesh** …from Hai-de-ra-baad.”

Ellipses work better than commas.

---

## 9. Capitalization for Emphasis (Optional)
Use capitalization to guide emphasis, not spelling.

**Examples**
- `Ruh-MESH`
- `BHA-gut`

Use sparingly.

---

## Minimal Safe Template

**Instead of**
> Ramesh from Hyderabad will join the call.

**Use**
> Ruh-mesh… from Hai-de-ra-baad… will join the call.

---

## What to Avoid
- Original Indian spellings without phonetic hints
- IPA symbols
- Expecting automatic schwa deletion
- Mixing multiple pronunciation styles in one script

---

### Key Principle
Treat the ElevenLabs script as **phonetic instructions**, not written text.


Important - 
I want this as an internal tool - easy stack - simple UI - can take csv file as input - and generate audio for each row - and save the audio and text in a folder - post verification - and create a .pls file of the right pronunciation of the proper nouns used through out different scripts


Steps for development - 
1. Extract proper nouns from the script
2. Create different version of the proper nouns
3. Generate audio for each version using elevenlabs - create using top 3 techniques automatically for rest on click of a button 
4. Allow user to select the right version
5. Add the right version of the proper noun in the original text
6. Generate the audio for the final text
7. Save the final text and audio
8. Create a database of the right pronunciation of the proper nouns used through out different scripts which can be later used to create .pls file.