# Default Settings Gaala

Kaveriporukan palkintogaalan äänestyssivu. Ei riippuvuuksia: tarvitaan vain Node.js 18 tai uudempi. Data tallentuu tiedostoon `data/db.json`.

## Miten äänestys etenee

| Vaihe | Mitä kaverit tekevät | Mitä admin tekee lopuksi |
| --- | --- | --- |
| 1. Kategoriaehdotukset | Ehdottavat kategorioita (oletuksena max 3/hlö). Omaa ehdotusta voi muokata ja poistaa ennen lukitusta. Tässä vaiheessa ei äänestetä. | Siirtää vaiheeseen 2. |
| 2. Kategoria-äänestys | Äänestävät, mitkä kategoriat pääsevät gaalaan (oletuksena 3 ääntä/hlö, max yksi per kategoria). "Vuoden sykähdyttävin hetki" on aina mukana. Lukitseminen vaatii vähintään yhden äänen. | Painaa "Valitse N eniten ääniä saanutta" (N = gaalan kategoriat − kiinteät) tai rastii käsin ja siirtää vaiheeseen 3. |
| 3. Ehdokkaat | Ehdottavat ehdokkaita valitsemalla henkilökortin (osallistujat kuvineen) ja kirjoittamalla "Mistä?" – saman henkilön voi ehdottaa samaan kategoriaan eri aiheista (oletuksena max 2 ehdotusta/kategoria). Ehdottaminen ei anna ääntä. Ääniä on 2 per kategoria, ja lukitseminen vaatii, että kaikki äänet on käytetty. | Painaa "Valitse 3 eniten ääniä saanutta jokaiseen" tai rastii finalistit käsin ja siirtää vaiheeseen 4. |
| 4. Finaali | Valitsevat pystykorteista yhden voittajan per kategoria. Lukitseminen vaatii vähintään yhden äänen. | Siirtää vaiheeseen 5 (suljettu). |
| 5. Suljettu | Näkevät viestin, että äänestys on päättynyt, ja voivat jättää palautetta ("Anonyymi palaute": muut näkevät palautteet ilman nimeä, adminit näkevät kirjoittajan hallinnan palautelokista). | Näkee hallinnassa tulokset (voittajat, finaalin äänimäärät ja kuka äänesti ketä) ja voi kopioida ne tekstinä gaalan diaesitystä varten. Voi poistaa palautteita. |

Vaiheiden 1–4 lopussa on **Lukko sisään** -nappi. Kun osallistuja lukitsee vastauksensa, hän ei voi enää muuttaa sen vaiheen ehdotuksia tai ääniä, ja hänelle näytetään odotusnäyttö ("Seuraava vaihe ei ole vielä alkanut"), kunnes admin avaa seuraavan vaiheen. Lukitseminen on vahvistus, ei pakollinen: lukitsemattomatkin äänet lasketaan. Admin näkee osallistujataulukosta, ketkä ovat lukinneet, ja voi avata lukon ("Avaa lukko"), jos joku lukitsi vahingossa.

- Osallistujat eivät näe toistensa ääniä eivätkä sitä, kuka ehdotti mitä. Adminit näkevät ehdottajat ja finaalin äänestäjät.
- Admin näkee osallistujataulukosta, montako ehdotusta tai ääntä kukin on käyttänyt tässä vaiheessa.
- Kuvat: admin lisää osallistujille kuvat osallistujataulukosta. Kuva näkyy henkilökorteissa ja ehdokaskorteissa. Yksittäiselle ehdokaskortille voi vaihtaa oman kuvan ehdokastaulukosta (esim. eri kuva eri kategoriassa). "Rajaa"-ikkunassa kuvaa voi vetää ja zoomata ja nähdä samalla esikatselun korteista; alkuperäinen kuva säilyy, joten rajausta voi muuttaa myöhemmin.
- Osallistujataulukon "Ehdokkaana"-ruudulla valitaan, näkyykö henkilö ehdotettavien henkilökorttien joukossa. Selain pienentää kuvan ennen lähetystä, ja kuvat näkyvät vain kirjautuneille. Kuvat tallentuvat `data/images`-kansioon.
- Äänimäärät näkee vain admin. Finaalin äänet ovat oletuksena piilossa myös adminilta, jotta voittajat ovat yllätys myös teille. Ne saa näkyviin valinnalla "Näytä finaalin äänet".
- Hallinnan asetuksista voi muuttaa gaalan kategoriamäärän, kategoria-äänestyksen äänet, ehdokasvaiheen äänet, ehdotusrajat ja näkyvän takarajan.
- Vanhan 4-vaiheisen version tietokanta muunnetaan automaattisesti uusiin vaihenumeroihin palvelimen käynnistyessä.
- Admin voi palata aiempaan vaiheeseen sekä poistaa asiattomia ehdotuksia.

## Hall of Fame

Yläpalkin **Hall of Fame** -napista aukeaa sivu, jolla näkyvät aiempien vuosien gaalat uusin ensin: jokaisesta kategoriasta voittaja (tasapelissä jaettu voitto) isona korttina ja muut ehdokkaat sen alla. Sivu näkyy kaikille kirjautuneille, kun vähintään yksi vuosi on tallennettu (adminille aina).

Adminit hallitsevat sivua sen alalaidasta:

- **Lisää aiempi gaala**: lomake, jossa annetaan vuosi ja lisätään kategoriat (nimi ja valinnainen kuvaus). Jokaiseen kategoriaan valitaan ehdokkaat osallistujalistasta (kortissa näkyy osallistujan kuva) tai valinnalla "Joku muu…" kirjoitetaan nimi itse. Lisäksi voi kertoa, mistä ehdokas oli ehdolla. Voittaja merkitään "★ Voittaja" -valinnalla, ja tasapelissä niitä voi merkitä useamman. Tyhjiksi jätetyt ehdokasrivit ohitetaan tallennettaessa.
- **Lisää gaala [vuosi] Hall of Fameen**: kun äänestys on suljettu (vaihe 5), tämän vuoden finalistit ja voittajat siirtyvät Hall of Fameen yhdellä napilla. Tee tämä ennen kuin nollaat gaalan seuraavaa vuotta varten. Nollaus ei poista Hall of Famea.
- Tallennettuja vuosia voi muokata ja poistaa.

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

- Kaikki data on tiedostossa `data/db.json` ja kuvat kansiossa `data/images`. Varmuuskopioksi riittää `data`-kansion kopioiminen.
- Jos haluatte aloittaa alusta, pysäyttäkää palvelin ja poistakaa `data/db.json`.
- Kadonneen koodin näkee hallinnan osallistujataulukosta.

## Tiedostot

- `server.js` – palvelin ja API (vain Noden omat moduulit)
- `public/index.html`, `public/app.js` – käyttöliittymä
- `public/styles.css` – ulkoasu (tumma gaalateema)
- `public/logo.svg` – logo (pokaali), myös välilehden kuvake
