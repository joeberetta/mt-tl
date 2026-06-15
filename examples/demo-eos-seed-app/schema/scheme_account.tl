---types---

inputReportReasonSpam#58dbcab8 = ReportReason;
inputReportReasonViolence#1e22c78d = ReportReason;
inputReportReasonPornography#2e59d922 = ReportReason;
inputReportReasonChildAbuse#adf44ee3 = ReportReason;
inputReportReasonOther#c1e4a2b1 = ReportReason;
inputReportReasonCopyright#9b89f93a = ReportReason;
inputReportReasonDiscrimination#4c827722 = ReportReason;
inputReportReasonProfanity#c3fba299 = ReportReason;
inputReportReasonExtremism#367202e7 = ReportReason;
inputReportReasonLies#6b0bcc73 = ReportReason;

privacyKeyStatusTimestamp#bc2eab30 = PrivacyKey;
privacyKeyChatInvite#500e6dfa = PrivacyKey;
privacyKeyPhoneCall#3d662b7b = PrivacyKey;
privacyKeyPhoneP2P#39491cc8 = PrivacyKey;
privacyKeyForwards#69ec56a3 = PrivacyKey;
privacyKeyProfilePhoto#96151fed = PrivacyKey;

privacyValueAllowContacts#fffe1bac = PrivacyRule;
privacyValueAllowAll#65427b82 = PrivacyRule;
privacyValueAllowUsers#4d5bbe0c users:Vector<int> = PrivacyRule;
privacyValueDisallowContacts#f888fa1a = PrivacyRule;
privacyValueDisallowAll#8b73e763 = PrivacyRule;
privacyValueDisallowUsers#0c7f49b7 users:Vector<int> = PrivacyRule;

updatePrivacy#ee3b272a key:PrivacyKey rules:Vector<PrivacyRule> = Update;

---functions---

// проверка на уникальность и валидацию полей перед регистрацией
account.checkFields#85ba63f6 flags:# phone_number:flags.0?string email:flags.1?string first_name:flags.2?string last_name:flags.3?string username:flags.4?string = Bool;
account.updateStatus#6628562c offline:Bool = Bool;

// Push notifications
account.registerDevice#5cbea590 token_type:int token:string app_sandbox:Bool secret:bytes other_uids:Vector<int> = Bool;
account.unregisterDevice#3076c4bf token_type:int token:string other_uids:Vector<int> = Bool;
