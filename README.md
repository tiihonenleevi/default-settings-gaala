# HerrasmiesKlubi Gaala

Järjestäjä: Default Settings Oy.

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

Yläpalkin **Hall of Fame** -napista aukeaa sivu, jolla näkyvät aiempien vuosien gaalat uusin ensin: jokaisesta kategoriasta voittaja (tasapelissä jaettu voitto) isona korttina ja muut ehdokkaat sen alla. Sivu on aluksi **piilossa muilta**: vain adminit näkevät sen (napissa merkki "piilossa"), joten sitä voi rakentaa rauhassa. Kun Hall of Fame on valmis, admin painaa sivun yläosan Näkyvyys-paneelista **Julkaise Hall of Fame**, jolloin se näkyy kaikille kirjautuneille. Samasta paneelista sen saa taas piiloon (**Piilota muilta**). Piilotettuna osallistujille ei lähetetä Hall of Famen sisältöä lainkaan. Kun vuosia on useampi, ne ovat välilehtinä (uusin valittuna). Valittu vuosi näkyy osoitteessa, esim. `/#hall-of-fame/2025`, joten linkin tiettyyn vuoteen voi jakaa.

Adminit hallitsevat sivua sen alalaidasta:

- **Lisää aiempi gaala**: lomake, jossa annetaan vuosi ja lisätään kategoriat (nimi ja valinnainen kuvaus). Jokaiseen kategoriaan valitaan ehdokkaat osallistujalistasta (kortissa näkyy osallistujan kuva) tai valinnalla "Joku muu…" kirjoitetaan nimi itse. Lisäksi voi kertoa, mistä ehdokas oli ehdolla. Voittaja merkitään "★ Voittaja" -valinnalla, ja tasapelissä niitä voi merkitä useamman. Tyhjiksi jätetyt ehdokasrivit ohitetaan tallennettaessa.
- **Kuvat**: Hall of Famen kuvat ovat omiaan, eivät osallistujien profiilikuvia. Kuva lisätään lomakkeella klikkaamalla rivin pyöreää kuvaa, raahaamalla kuva riville tai liittämällä se leikepöydältä (klikkaa riviä, esim. "Mistä?"-kenttää, ja paina Ctrl+V). Myös Google Slidesistä ja Docsista kopioidut kuvat toimivat: niiden leikepöydällä on vain linkki Googlen kuvapalvelimelle, joten gaalan palvelin hakee kuvan sieltä (vain Googlen kuvapalvelimilta, palvelimella pitää olla nettiyhteys), jolloin rajausikkuna aukeaa (sama kuin profiilikuvissa: vedä ja zoomaa, esikatselu korteista). Rajauksen voi muuttaa myöhemmin rivin "Rajaa"-linkistä. Kuva ja rajaus tallentuvat "Tallenna gaala" -napista. Osallistujan poisto tai profiilikuvan vaihto ei vaikuta Hall of Famen kuviin. Alle K18 -tilassa kuvien tilalla näkyy nimikirjain. Kuvat tallentuvat `data/images`-kansioon muiden kuvien tapaan.
- **Lisää gaala [vuosi] Hall of Fameen**: kun äänestys on suljettu (vaihe 5), tämän vuoden finalistit ja voittajat siirtyvät Hall of Fameen yhdellä napilla (ehdokaskorttien omat kuvat rajauksineen kopioidaan mukaan; profiilikuvia ei käytetä, joten puuttuvat kuvat lisätään muokkaamalla vuotta). Tee tämä ennen kuin nollaat gaalan seuraavaa vuotta varten. Nollaus ei poista Hall of Famea.
- **Kansikuva**: jokaiselle vuodelle voi lisätä kansikuvan (esim. ryhmäkuva gaalasta), joka näkyy "Gaala 2025" -otsikon alla. Se lisätään lomakkeen yläosasta samoilla tavoilla kuin ehdokkaiden kuvat (klikkaus, raahaus tai liittäminen) ja rajataan leveään 16:9-muotoon. Alle K18 -tilassa kansikuva on piilossa.
- Tallennettuja vuosia voi muokata ja poistaa.



## Palkintosivut ja QR-koodit

Jokaisella Gaalaan päässeellä kategorialla on oma **palkintosivu** osoitteessa `/p/<tunniste>`, jonka QR-koodin voi tulostaa pokaalin pohjaan. Sivulla on kategorian nimi ja palkintokoroke: 2. sija vasemmalla, 1. keskellä korkeimmalla ja 3. oikealla, kuvineen. Sivu näkyy **ilman kirjautumista**, mutta muualta sivustolta ei ole sinne linkkiä. Tunniste on satunnainen, joten sivuja ei voi arvata.

- Hallinnassa (**Palkintosivut ja QR-koodit**) on jokaisen kategorian QR-koodi, linkki ja PNG-lataus (1200 px) sekä **Tulosta kaikki QR-koodit** -arkki. Tarkista **QR-koodien osoite** (Funnelin osoite) ennen tulostamista.
- Ennen julkaisua sivulla lukee "Voittaja julkistetaan Gaalassa". **Julkaise tulokset** paljastaa sijat kaikilla sivuilla; auki olevat sivut päivittyvät itsestään.
- Sijat tulevat finaalin äänimääristä (tasapelissä sama sija). **Muokkaa sijoja** asettaa ne käsin.
- Kun vuosi arkistoidaan Hall of Fameen, sijat ja tunnisteet siirtyvät mukaan, joten pokaalin QR-koodi toimii jatkossakin. Hall of Famen lomakkeessa jokaiselle ehdokkaalle voi valita sijan (1. = voittaja), ja myös aiemmille vuosille syntyy palkintosivut.
- Palkintosivulta pääsee **Hall of Fameen** (vaatii kirjautumisen) ja sieltä **takaisin palkintosivulle**.
- QR-koodit tehdään selaimessa kirjastolla `public/vendor/qrcode.js` (qrcode-generator 1.4.4, MIT).
## Discord-ilmoitukset

Palvelin voi lähettää tapahtumista ilmoituksen adminien Discord-kanavalle **webhookin** kautta (pelkkä HTTPS-pyyntö, ei bottia).

1. Discordissa: kanavan asetukset → **Integraatiot → Webhookit → Uusi webhook** → **Kopioi webhookin URL**.
2. Gaalan hallinnassa: **Discord-ilmoitukset** → liitä osoite → **Tallenna ilmoitusasetukset** → **Lähetä testiviesti**.

Osoite on salaisuus: se tallennetaan palvelimelle (`data/db.json`) eikä sitä näytetä selaimessa tallennuksen jälkeen. Vaihtoehtoisesti sen voi antaa ympäristömuuttujana `DISCORD_WEBHOOK`.

Ilmoitukset (kunkin tyypin voi kytkeä pois hallinnasta):
- **Virheet:** epäonnistuneet kuvalataukset (käyttäjä, tiedosto, virhe, selain) ja palvelinvirheet
- **Lukon avauspyynnöt:** osallistuja painaa odotusnäytöllä **Pyydä lukon avausta** → ilmoitus kertoo kuka ja mistä vaiheesta. Pyyntö näkyy myös hallinnassa ("Lukon avausta pyytää" ja merkki Avaa lukko -napissa) ja poistuu, kun lukko avataan.
- **Lukitukset:** kuka lukitsi ja montako on lukinnut, ilmoitus kun kaikki ovat lukinneet, adminin avaamat lukot
- **Vaiheen vaihtuminen**, **palautteet** (kirjoittajan nimellä) ja **kuvaehdotukset**
- **Muistutukset** vaiheissa 1–4: lukitsemattomien lista kerran päivässä valittuun aikaan (oletus 18:00), 24 h ja 2 h ennen vaiheen päättymistä sekä päättymisajan mentyä. Ajat ovat Suomen aikaa (`GAALA_TZ`, oletus `Europe/Helsinki`).

Jos webhookia ei ole asetettu, ilmoitukset ovat pois päältä. Discordin katko ei vaikuta gaalaan.

### Julkinen päivittäinen tiedote

Toinen, erillinen webhook osallistujien kanavalle (hallinta → **Julkinen päivittäinen tiedote**). Vaiheissa 1–4 palvelin lähettää kerran päivässä valittuun aikaan (oletus 12:00) virallisen kaksikielisen tiedotteen: montako jäsentä on lyönyt vaiheen lukkoon ja paljonko aikaa vaiheen päättymiseen on (tänään / huomenna / N päivää, vaiheen päättymisajan mukaan). Tiedotteessa ei ole nimiä. Lopussa on allekirjoitus ja maininta automaattisesta viestistä. Pingattavan roolin (esim. @Gaala-jäsenet) voi asettaa roolin ID:llä; muuten ketään ei pingata. Hallinnassa tekstin voi esikatsella ja lähettää heti (**Lähetä nyt**).
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
Description=HerrasmiesKlubi Gaala
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
