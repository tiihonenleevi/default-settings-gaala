# Default Settings Gaala

Kaveriporukan palkintogaalan äänestyssivu. Ei riippuvuuksia: tarvitaan vain Node.js 18 tai uudempi. Data tallentuu tiedostoon `data/db.json`.

## Miten äänestys etenee

| Vaihe | Mitä kaverit tekevät | Mitä admin tekee lopuksi |
| --- | --- | --- |
| 1. Kategoriat | Ehdottavat kategorioita (oletuksena max 3/hlö) ja äänestävät niitä. Ääniä on yhtä monta kuin gaalaan valitaan kategorioita äänestämällä: jos gaalassa on 8 palkintoa, ääniä on 7, koska "Vuoden sykähdyttävin hetki" on aina mukana. Yhdelle kategorialle voi antaa vain yhden äänen. | Painaa "Valitse N eniten ääniä saanutta" (tai rastii käsin) ja siirtää vaiheeseen 2. |
| 2. Ehdokkaat | Ehdottavat ehdokkaita jatkoon päässeisiin kategorioihin. Ehdotukseen kuuluu aina "Mistä?", joten saman henkilön voi ehdottaa samaan kategoriaan eri aiheista. Jokainen ehdotus näkyy kaikille korttina, jossa on äänestysnappi. Ääniä on 2 per kategoria, ja oma ehdotus vie automaattisesti yhden äänen. Äänen voi siirtää myöhemmin. | Rastii finalistit jokaiseen kategoriaan ja siirtää vaiheeseen 3. |
| 3. Finaali | Antavat yhden äänen per kategoria. Valintaa voi vaihtaa, kunnes äänestys suljetaan. | Siirtää vaiheeseen 4 (suljettu). |
| 4. Suljettu | Näkevät viestin, että äänestys on päättynyt ja voittajat julkistetaan gaalassa. | Näkee hallinnassa tulokset (voittajat ja finaalin äänimäärät) ja voi kopioida ne tekstinä gaalan diaesitystä varten. |

- Äänet ja ehdottajat ovat anonyymejä. Kukaan ei näe, kuka ehdotti mitä tai kuka äänesti ketä.
- Äänimäärät näkee vain admin. Finaalin äänet ovat oletuksena piilossa myös adminilta, jotta voittajat ovat yllätys myös teille. Ne saa näkyviin valinnalla "Näytä finaalin äänet".
- Hallinnan asetuksista voi muuttaa gaalan kategoriamäärän (josta vaiheen 1 äänet lasketaan), vaiheen 2 äänet, ehdotusrajat ja näkyvän takarajan.
- Admin voi palata aiempaan vaiheeseen sekä poistaa asiattomia ehdotuksia.

## Käynnistys

```bash
cp .env.example .env      # vaihda ADMIN_CODE (vähintään 8 merkkiä)
node server.js            # tai: npm start
```

Sivu aukeaa osoitteessa `http://127.0.0.1:3000`.

Kun sivu on käynnissä:

1. Kirjaudu sisään `ADMIN_CODE`:lla. Ylläpitotunnuksella voi vain hallinnoida, ei äänestää.
2. Lisää hallinnassa kaikki osallistujat, myös itsenne. Kirjoita nimet pilkuilla tai riveittäin erotettuna, jolloin jokainen saa oman koodin (muotoa `HB95-GHNB`).
3. Rastikaa itsellenne Admin ja kirjautukaa jatkossa omilla koodeillanne.
4. Lähetä jokaiselle kaverille hänen oma linkkinsä ("Kopioi linkki"). Linkki kirjaa kaverin sisään suoraan. Vaihtoehtoisesti kaveri voi kirjoittaa koodinsa kirjautumissivulle.

Koodi on henkilökohtainen, joten äänirajat ja anonymiteetti toimivat koodin kautta. Jos koodi leviää väärälle henkilölle, "Uusi koodi" mitätöi vanhan heti. Kymmenen väärää koodia kymmenen minuutin sisällä estää kirjautumisen samasta osoitteesta hetkeksi.

### Pysyvästi päälle (systemd)

```ini
# /etc/systemd/system/gaala.service
[Unit]
Description=Default Settings Gaala
After=network.target

[Service]
WorkingDirectory=/opt/gaala
ExecStart=/usr/bin/node server.js
Restart=always
User=gaala

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now gaala
```

### Tai Dockerilla

```bash
docker build -t gaala .
docker run -d --name gaala --restart unless-stopped \
  -p 127.0.0.1:3000:3000 -v gaala-data:/app/data \
  -e ADMIN_CODE=... gaala
```

## Jakaminen Tailscalella

Palvelin kuuntelee vain osoitetta `127.0.0.1`, joten se ei näy suoraan verkkoon. Tailscale välittää sen tailnetiin HTTPS:llä:

```bash
tailscale serve --bg 3000
tailscale serve status    # näyttää osoitteen, esim. https://palvelin.tailXXXX.ts.net
```

Kaverit pääsevät sivulle kahdella tavalla:

- **Samaan tailnetiin:** kutsu heidät Tailscalen admin-konsolissa (Users → Invite).
- **Jaa vain tämä kone:** admin-konsolissa koneen kohdalla Share… Kaverit tarvitsevat oman ilmaisen Tailscale-tilin, mutta eivät näe muita koneitanne.

Jos kaverit näkevät tailnetissä muitakin koneita, rajatkaa pääsy ACL:llä pelkästään tähän koneeseen ja porttiin 443.

**Älä käytä `tailscale funnel` -komentoa.** Se avaa sivun koko internetiin. Henkilökohtaiset koodit suojaavat silti sisäänkirjautumisen, mutta pelkkä tailnet on turvallisempi.

## Varmuuskopio ja nollaus

- Kaikki data on tiedostossa `data/db.json`. Varmuuskopioksi riittää tämän tiedoston kopioiminen.
- Jos haluatte aloittaa alusta, pysäyttäkää palvelin ja poistakaa `data/db.json`.
- Kadonneen koodin näkee hallinnan osallistujataulukosta.

## Tiedostot

- `server.js` – palvelin ja API (vain Noden omat moduulit)
- `public/index.html`, `public/app.js` – käyttöliittymä
- `public/styles.css` – design systemin tokenit (tumma teema ensisijainen, vaalea tulee automaattisesti laitteen asetuksista)
