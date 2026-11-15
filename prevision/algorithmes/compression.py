"""Compression : lire les données compressées de l'application et alléger les sorties.

1. Décompression du cube radar (cube_province.js)
   Le script de préparation range chaque valeur dans un octet
   (quantification : -35..+5 dB -> 0..254, 255 = vide), puis compresse
   le tout en gzip (algorithme DEFLATE = LZ77 + codage de Huffman) et
   l'écrit en base64 pour qu'un simple fichier .js le transporte.
   On fait le chemin inverse : base64 -> gzip -> octets.

2. Quantification des sorties
   Les prévisions n'ont pas besoin de 17 chiffres : on garde 5 chiffres
   significatifs. C'est une compression avec perte contrôlée, très
   inférieure à l'incertitude des prévisions elles-mêmes.

3. Mesure du gain
   On calcule la taille gzip de la sortie pour savoir ce qu'un serveur
   web compressant ses fichiers enverrait réellement.
"""
import base64
import gzip
import json
import math


def decoder_cube(gz_b64):
    """Octets bruts du cube : base64 -> gzip -> bytes."""
    return gzip.decompress(base64.b64decode(gz_b64))


def arrondir(v, chiffres=5):
    """Arrondi à un nombre de chiffres significatifs (quantification)."""
    if v == 0 or not math.isfinite(v):
        return v
    return round(v, chiffres - 1 - int(math.floor(math.log10(abs(v)))))


def quantifier(obj, chiffres=5):
    """Applique arrondir() à tous les nombres réels d'une structure JSON."""
    if isinstance(obj, float):
        return arrondir(obj, chiffres)
    if isinstance(obj, dict):
        return {k: quantifier(v, chiffres) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [quantifier(v, chiffres) for v in obj]
    return obj


def json_compact(obj):
    """JSON sans espaces inutiles (les accents restent lisibles)."""
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def bilan(texte):
    """Taille brute et taille gzip d'un texte, en octets."""
    brut = texte.encode('utf-8')
    return len(brut), len(gzip.compress(brut, 9))
