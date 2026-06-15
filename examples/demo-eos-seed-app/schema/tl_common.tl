---types---

pagination#fca3600e total:int count:int previous:bool next:bool = Pagination;

// Unsupported types for backward compatibility
updateUnsupported#db10bf20 pts:int pts_count:int = Update;

unsupportedAccountCreated#232e24b2 = ServiceAccount;
updateServiceAccountCreated#962e20ee service:ServiceAccount pts:int = Update;

// ???
fileLocationLink#d18c34cb file_name:string mime_type:string url:string size:int access_hash:long = FileLocationLink;
fileLocationLinkWithThumbnails#78470b4a flags:# file_name:string mime_type:string url:string size:int access_hash:long thumbnails:flags.0?Vector<FileLocationLink> = FileLocationLink;

documentAttributeDocument#a6f11ece = DocumentAttribute;

---types---

help.deepLinkInfoInternalWallet#422785d5 flags:# address:string token_type:string user:User amount:flags.0?string memo:flags.1?string = help.DeepLinkInfo;
help.deepLinkInfoExternalWallet#2b129fe8 flags:# address:string token_types:flags.0?Vector<string> symbol:flags.1?string contract_address:flags.2?string chain_id:flags.3?int amount:flags.4?string memo:flags.5?string = help.DeepLinkInfo;
help.deepLinkInfoBranch#3fed1d9e url:string data:DataJSON = help.DeepLinkInfo;
help.deepLinkInfoLnInvoice#4041a2e2 data:invoices.Invoice = help.DeepLinkInfo;

help.deepLinkInfoWalletConnectPairingUriProtocolOptions#50f6a964 flags:# protocol:string data:flags.0?string = help.DeepLinkInfoWalletConnectPairingUriProtocolOptions;
help.deepLinkInfoWalletConnectPairingUri#686a8bbf topic:string sym_key:string protocol_options:help.DeepLinkInfoWalletConnectPairingUriProtocolOptions version:string = help.DeepLinkInfo;
