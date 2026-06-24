# Log in with a recipe

Authenticate a user with an auth recipe, then verify a field. Connect to your
server in the bar above (and author an `eos-login` recipe under **▸ auth recipes**),
then open this as an interactive scenario — the steps below pre-fill, and you only
fill the auth args.

```scenario
target:
    url: ws://localhost:9000
users:
    user: { auth: { recipe: eos-login, with: { phone: "", seed: "" } } }
steps:
    - { as: user, label: "check a free field", invoke: account.checkFields, params: { phone_number: "+15550001" }, expect: { _: boolTrue } }
```

The recipe runs `crypto.sendCode` → sign → `crypto.signIn` (you write it in
`▸ auth recipes`), then the step runs on the authorized session.
