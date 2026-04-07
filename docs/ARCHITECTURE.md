# Scamly Beta architecture

Extension local scan -> optional Deep AI Check -> Scamly backend -> OpenAI Responses API

The extension never contains the OpenAI API key. The backend holds the key and returns a scored JSON result.
