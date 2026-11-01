#!/usr/bin/env python3
"""Recorta tools/rangos-slapshot.png (captura oficial "ALL RANKS" del juego) en un logo por rango.

Uso: python3 tools/cut-ranks.py tools/rangos-slapshot.png assets/ranks /tmp/vista.png
Quita el fondo azul del panel (con bordes suaves), guarda cada rango a 128 px y escribe assets/ranks/index.json.
Después hay que generar las versiones de 64 px (ver el historial del repositorio) si se vuelven a recortar.
"""
from PIL import Image
import numpy as np, json, os, sys
from scipy import ndimage
SRC, OUT, PREV = sys.argv[1], sys.argv[2], sys.argv[3]
im=Image.open(SRC).convert('RGBA')
a=np.asarray(im).astype(float); H,W=a.shape[:2]
B=np.array([38,110,171.])
C=a[...,:3]
d=np.sqrt(((C-B)**2).sum(-1))
panel=np.zeros((H,W),bool); panel[22:827,2:337]=True
mask=(d>40)&panel
lab,n=ndimage.label(ndimage.binary_dilation(mask,iterations=3))
boxes=[]
for i,sl in enumerate(ndimage.find_objects(lab)):
    h=sl[0].stop-sl[0].start; w=sl[1].stop-sl[1].start
    if h>40 and w>40: boxes.append([sl[0].start,sl[0].stop,sl[1].start,sl[1].stop,i+1])
boxes.sort(key=lambda b:(b[0]+b[1])/2)
rows=[]
for b in boxes:
    cy=(b[0]+b[1])/2
    if rows and abs(cy-np.mean([(x[0]+x[1])/2 for x in rows[-1]]))<30: rows[-1].append(b)
    else: rows.append([b])
order=[]
for r in rows: order+=sorted(r,key=lambda b:b[2])
keys=['LEGEND','DIAMOND','PLAT_I','PLAT_II','PLAT_III','GOLD_I','GOLD_II','GOLD_III','SILVER_I','SILVER_II','SILVER_III','BRONZE_I','BRONZE_II','BRONZE_III']
assert len(order)==14, len(order)
# "color to alpha" con el azul de fondo (mínima opacidad que reproduce el color), solo en el borde
def c2a(C):
    al=np.zeros(C.shape[:2])
    for k in range(3):
        c=C[...,k]; b=B[k]
        up=(c-b)/(255-b); dn=(b-c)/b
        al=np.maximum(al,np.where(c>=b,up,dn))
    return np.clip(al,0,1)
os.makedirs(OUT,exist_ok=True)
idx={}; tiles=[]
for key,(y0,y1,x0,x1,li) in zip(keys,order):
    comp=(lab==li)
    thr=80 if key=='PLAT_III' else 40
    solid=ndimage.binary_fill_holes((d>thr)&comp)
    solid=ndimage.binary_opening(solid,iterations=1) if key=='PLAT_III' else solid
    solid=ndimage.binary_closing(solid,iterations=2)
    solid=ndimage.binary_fill_holes(solid)
    inner=ndimage.binary_erosion(solid,iterations=2)
    outer=ndimage.binary_dilation(solid,iterations=3)
    al=c2a(C)
    # huecos encerrados (fondo entre alas y escudo): transparentes también
    pocket=inner&(d<22)
    pocket=ndimage.binary_dilation(pocket,iterations=1)&inner
    alpha=np.where(inner&~pocket,1.0,np.where(outer,al,0.0))
    # color del primer plano: se quita el azul mezclado en el borde
    F=C.copy()
    edge=outer&~(inner&~pocket)
    aa=np.maximum(alpha,1e-3)[...,None]
    Fe=(C-(1-aa)*B)/aa
    F=np.where(edge[...,None],np.clip(Fe,0,255),C)
    if key.startswith('PLAT'):
        # los de platino son lilas con borde claro (y el III tiene un halo de luz: se separa por el tono ): se separan del fondo por el tono
        rg=C[...,0]-C[...,1]
        al3=np.clip((rg+36)/30,0,1)*comp
        core=ndimage.binary_fill_holes(al3>0.95)
        al3=np.where(core,1.0,al3)
        idx_near=ndimage.distance_transform_edt(~core,return_distances=False,return_indices=True)
        near=C[idx_near[0],idx_near[1]]
        F=np.where((al3<1)[...,None],near,C)
        alpha=al3
    pad=4
    ys,ye,xs,xe=max(0,y0-pad),min(H,y1+pad),max(0,x0-pad),min(W,x1+pad)
    rgba=np.dstack([F,alpha*255])[ys:ye,xs:xe].round().astype(np.uint8)
    t=Image.fromarray(rgba,'RGBA')
    bb=t.getbbox(); t=t.crop(bb)
    side=max(t.size)+4
    sq=Image.new('RGBA',(side,side),(0,0,0,0)); sq.paste(t,((side-t.size[0])//2,(side-t.size[1])//2))
    # se guarda a 128 px (los más pequeños se amplían un poco con Lanczos)
    out=sq.resize((128,128),Image.LANCZOS)
    out.save(os.path.join(OUT,key+'.png'),optimize=True)
    idx[key]=key+'.png'; tiles.append(out)
order_keys=['BRONZE_I','BRONZE_II','BRONZE_III','SILVER_I','SILVER_II','SILVER_III','GOLD_I','GOLD_II','GOLD_III','PLAT_I','PLAT_II','PLAT_III','DIAMOND','LEGEND']
json.dump({k:idx[k] for k in order_keys},open(os.path.join(OUT,'index.json'),'w'),indent=2)
# vista previa sobre fondo oscuro y claro, a tamaño grande y pequeño
tiles={k:Image.open(os.path.join(OUT,k+'.png')) for k in order_keys}
pv=Image.new('RGBA',(14*72,72*2+40),(0,0,0,0))
for row,bg in enumerate([(26,27,34,255),(237,241,246,255)]):
    band=Image.new('RGBA',(14*72,72),bg)
    for i,k in enumerate(order_keys): band.alpha_composite(tiles[k].resize((64,64),Image.LANCZOS),(i*72+4,4))
    pv.paste(band,(0,row*72))
small=Image.new('RGBA',(14*72,40),(26,27,34,255))
for i,k in enumerate(order_keys): small.alpha_composite(tiles[k].resize((22,22),Image.LANCZOS),(i*72+20,9))
pv.paste(small,(0,144))
pv.save(PREV)
print('ok', {k:os.path.getsize(os.path.join(OUT,k+'.png')) for k in order_keys})
