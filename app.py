from flask import Flask, request, jsonify
import requests
import json

app = Flask(__name__)

# यहाँ अपना Meta Page Access Token डालें
PAGE_ACCESS_TOKEN = "YOUR_FACEBOOK_PAGE_ACCESS_TOKEN"
# कोई भी सीक्रेट शब्द रख लें जो फेसबुक में वेरीफाई करते समय काम आएगा
VERIFY_TOKEN = "MY_SECRET_JERRY_TOKEN"

# 1. Abuse शब्दों की लिस्ट लोड करना
def load_abuse_words():
    try:
        with open('abuse_words.json', 'r', encoding='utf-8') as file:
            data = json.load(file)
            return data.get("blocked_words", [])
    except FileNotFoundError:
        return []

# 2. मैसेंजर पर यूज़र को रिप्लाई भेजने का फंक्शन
def send_message(recipient_id, text_message):
    url = f"https://facebook.com{PAGE_ACCESS_TOKEN}"
    payload = {
        "recipient": {"id": recipient_id},
        "message": {"text": text_message}
    }
    headers = {"Content-Type": "application/json"}
    requests.post(url, json=payload, headers=headers)

# 3. फेसबुक वेबहुक वेरिफिकेशन (सिर्फ पहली बार सेटअप के लिए)
@app.route('/webhook', methods=['GET'])
def verify():
    if request.args.get("hub.mode") == "subscribe" and request.args.get("hub.challenge"):
        if not request.args.get("hub.verify_token") == VERIFY_TOKEN:
            return "Verification token mismatch", 403
        return request.args.get("hub.challenge"), 200
    return "Hello World", 200

# 4. लाइव मैसेज रिसीव और स्कैन करने का मुख्य लॉजिक
@app.route('/webhook', methods=['POST'])
def webhook():
    data = request.get_json()
    
    if data["object"] == "page":
        for entry in data["entry"]:
            for messaging_event in entry["messaging"]:
                if messaging_event.get("message"):
                    sender_id = messaging_event["sender"]["id"]
                    message_text = messaging_event["message"].get("text", "")
                    
                    # चैट में बॉट का नाम (जैसे @JerryBot) और गाली स्कैन करना
                    bot_mention = "@jerrybot"
                    message_lower = message_text.lower()
                    
                    if bot_mention in message_lower:
                        blocked_words = load_abuse_words()
                        clean_text = message_lower.replace(bot_mention, "").strip()
                        
                        # क्या बचे हुए मैसेज में कोई गाली है?
                        contains_abuse = any(word in clean_text for word in blocked_words)
                        
                        if contains_abuse:
                            # फेसबुक मैसेंजर API सीधे ग्रुप मैसेज डिलीट करने की अनुमति नहीं देता,
                            # इसलिए बॉट तुरंत चेतावनी (Warning) रिप्लाई भेजेगा।
                            warning_reply = "⚠️ चेतावनी! बॉट को मेंशन करके अपशब्द या गाली लिखना मना है। कृपया तमीज से बात करें।"
                            send_message(sender_id, warning_reply)
                            
    return "EVENT_RECEIVED", 200

if __name__ == '__main__':
    app.run(port=5000, debug=True)
  
