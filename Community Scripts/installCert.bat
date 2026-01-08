@echo off

set CERTIFICATE="%~dp0[ Name of your Cert file ].cer" :: Of course you replace the hole block [**]

certutil -addstore -f root %CERTIFICATE%
certutil -addstore -f TrustedPublisher %CERTIFICATE%
pause
